import { bindClient, newWallet } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { PlayerRepositoryPort } from '../../src/application/ports/players/player.repository.port.js';
import { Player } from '../../src/domain/players/player.entity.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';

export function termsScenarios(h: () => Harness): void {
  const { login, anon } = bindClient(h);
  beforeEach(() => h().reset());
  const accept = { termsVersion: 1, privacyVersion: 1, age18: true, accepted: true };
  it('requires explicit current acceptance and never invents it at sign-in or on read', async () => {
    await anon().get('/api/profile/terms').expect(401);
    const rider = await login(newWallet(), { offer: false, terms: false });
    expect((await rider.agent.get('/api/profile/terms').expect(200)).body).toEqual({ required: true, termsVersion: 1, privacyVersion: 1, acceptedTermsVersion: null, acceptedPrivacyVersion: null });
    expect((await rider.agent.post('/api/tickets').send({ poolId: 1, qty: 1, burnWarningAccepted: true }).expect(428)).body.code).toBe('terms_required');
    await rider.agent.post('/api/profile/terms').send({ ...accept, accepted: false }).expect(400);
    await rider.agent.post('/api/profile/terms').send({ ...accept, age18: false }).expect(400);
    await rider.agent.post('/api/profile/terms').send({ ...accept, termsVersion: 2 }).expect(428);
    await rider.agent.post('/api/profile/terms').send({ ...accept, wallet: 'other' }).expect(400);
    expect((await rider.agent.post('/api/profile/terms').send(accept).expect(200)).body.required).toBe(false);
    await rider.agent.post('/api/profile/terms').send(accept).expect(200);
    const agreements = (await rider.agent.get('/api/me').expect(200)).body.agreements;
    expect(agreements).toMatchObject({ age18: true, loss: false });
    if (h().persistence === 'postgres') {
      const rows = await h().app.get(PrismaService).termsAcceptance.findMany({ where: { wallet: rider.address } });
      expect(rows).toEqual([{ wallet: rider.address, termsVersion: 1, privacyVersion: 1, age18: true, acceptedAt: h().clock.now() }]);
    }
  });
  it('permits training lifecycle without consent, but stale versions block reward actions and require reacceptance', async () => {
    const rider = await login(newWallet(), { offer: false, terms: false });
    const ride = (await rider.agent.post('/api/rides').send({ tier: 'free', level: 2 }).expect(200)).body;
    await rider.agent.post(`/api/rides/${ride.id}/start`).send({}).expect(200);
    await rider.agent.post(`/api/rides/${ride.id}/heartbeat`).send({ s: 0, t: 0, hull: 100 }).expect(200);
    await rider.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'failed', reason: 'crash', s: 0, t: 0, hull: 100 }).expect(200);
    await rider.agent.post('/api/profile/terms').send(accept).expect(200);
    const players = h().app.get(PlayerRepositoryPort), player = await players.findByWallet(rider.address);
    await players.save(Player.restore({ ...player!.snapshot(), termsVersion: 0 }));
    expect((await rider.agent.get('/api/profile/terms').expect(200)).body.required).toBe(true);
    await rider.agent.post('/api/airdrop/claim').send({}).expect(428);
    await rider.agent.post('/api/profile/terms').send(accept).expect(200);
    expect((await rider.agent.get('/api/profile/terms').expect(200)).body.required).toBe(false);
  });
}
