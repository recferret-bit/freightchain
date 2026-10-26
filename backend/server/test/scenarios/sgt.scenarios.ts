import request from 'supertest';
import { PublicKey } from '@solana/web3.js';
import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { sgtFixture, sgtRpc } from '../support/sgt-fixture.js';
import { PlayerRepositoryPort } from '../../src/application/ports/players/player.repository.port.js';
import { SgtRepositoryPort } from '../../src/application/trust/sgt.port.js';

export function sgtScenarios(h: () => Harness): void {
  const { login } = bindClient(h);
  beforeEach(() => h().reset());
  afterEach(() => vi.unstubAllGlobals());
  it('requires the authenticated wallet and rejects arbitrary client evidence', async () => {
    await request(h().server()).post('/api/me/trust/sgt').send({}).expect(401);
    const rider = await login();
    await rider.agent.post('/api/me/trust/sgt').send({ wallet: 'other', hasSGT: true }).expect(400);
    expect((await rider.agent.get('/api/me/trust/sgt').expect(200)).body).toMatchObject({ enabled: true, claimed: false, trustScore: 60 });
  });
  it('verifies real binary provider fixtures, persists once, blocks transferred claim and never repairs a penalty on retry', async () => {
    const first = await login(), second = await login();
    const f = sgtFixture(new PublicKey(first.address)); vi.stubGlobal('fetch', sgtRpc(f));
    expect((await first.agent.post('/api/me/trust/sgt').send({}).expect(200)).body).toMatchObject({ claimed: true, trustScore: 100 });
    expect(await h().app.get(SgtRepositoryPort).byWallet(first.address)).toMatchObject({ mint: f.mint.toBase58(), slot: 101 });
    const players = h().app.get(PlayerRepositoryPort), p = (await players.findByWallet(first.address))!;
    p.applyTrustEvent('rejected'); await players.save(p);
    vi.stubGlobal('fetch', sgtRpc(sgtFixture(new PublicKey(second.address), f.mint)));
    expect((await second.agent.post('/api/me/trust/sgt').send({}).expect(409)).body.code).toBe('sgt_already_used');
    expect((await players.findByWallet(second.address))?.trustScore).toBe(60);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('must not query again')));
    expect((await first.agent.post('/api/me/trust/sgt').send({}).expect(200)).body.trustScore).toBe(85);
  });
  it('distinguishes no asset, wrong cluster and provider outage without awarding trust', async () => {
    const rider = await login(), f = sgtFixture(new PublicKey(rider.address));
    vi.stubGlobal('fetch', sgtRpc(f, { discovery: { context: { slot: 100 }, value: [] } }));
    expect((await rider.agent.post('/api/me/trust/sgt').send({}).expect(409)).body.code).toBe('sgt_not_held');
    vi.stubGlobal('fetch', sgtRpc(f, { genesis: 'devnet' }));
    expect((await rider.agent.post('/api/me/trust/sgt').send({}).expect(503)).body.code).toBe('sgt_unavailable');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-rpc-key')));
    const response = await rider.agent.post('/api/me/trust/sgt').send({}).expect(503);
    expect(response.text).not.toContain('private-rpc-key');
    expect(await h().app.get(SgtRepositoryPort).byWallet(rider.address)).toBeNull();
  });
}
