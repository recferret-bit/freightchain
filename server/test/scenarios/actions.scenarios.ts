import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import { DEVNET_BLOCKCHAIN_ID } from '../../src/domain/actions/action-card.js';
import { bindClient, newWallet } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { aPool } from '../support/pools.js';

/* Solana Actions. The default harness is transfer mode (no buy). The program harness buys one ticket through the same order as the lobby. */
export const ACTIONS_PROGRAM_ENV = { PAYMENT_MODE: 'program', TICKET_PROGRAM_ID: '9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx' };

const RULES = [
  { pathPattern: '/', apiPath: '/api/actions/shift' },
  { pathPattern: '/r/**', apiPath: '/api/actions/ride/**' },
  { pathPattern: '/api/actions/**', apiPath: '/api/actions/**' },
];

export function actionsScenarios(h: () => Harness): void {
  const { anon, login } = bindClient(h);
  beforeEach(() => h().reset());

  it('discovery files and the preflight carry blink CORS and the devnet chain id', async () => {
    for (const path of ['/actions.json', '/.well-known/actions.json']) {
      const res = await anon().get(path).expect(200);
      expect(res.body.rules).toEqual(RULES);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['x-blockchain-ids']).toBe(DEVNET_BLOCKCHAIN_ID);
      expect(res.headers['x-action-version']).toBe('2.4');
    }
    const pre = await anon().options('/api/actions/shift').expect(204);
    expect(pre.headers['access-control-allow-origin']).toBe('*');
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();
    expect(pre.headers['x-blockchain-ids']).toBe(DEVNET_BLOCKCHAIN_ID);
  });

  it('transfer mode has no buy button; a bad account is {message}, not problem+json', async () => {
    const card = await anon().get('/api/actions/shift').expect(200);
    expect(card.body.type).toBe('action');
    expect(card.body.description).toMatch(/devnet/i);
    expect(card.body.description).toMatch(/No paid pool is on sale right now/);
    expect(card.body.links.actions.every((a: { type: string }) => a.type !== 'transaction')).toBe(true);
    const bad = await anon().post('/api/actions/shift/1h').send({ account: 'nope' }).expect(400);
    expect(bad.headers['content-type']).toMatch(/application\/json/);
    expect(bad.headers['content-type']).not.toMatch(/problem\+json/);
    expect(bad.body).toEqual({ message: expect.stringMatching(/Solana account/) });
    const off = await anon().post('/api/actions/shift/1h').send({ account: newWallet().address }).expect(503);
    expect(off.body.message).toMatch(/not on this server yet/);
    // a blink client POSTs { account, type } to every href, link buttons included, and opens the externalLink it answers
    for (const a of card.body.links.actions as { type: string; href: string }[]) {
      expect(a.href).toMatch(/^\/api\/actions\//);
      const link = await anon().post(a.href).send({ account: newWallet().address, type: a.type }).expect(200);
      expect(link.body).toMatchObject({ type: 'external-link', externalLink: expect.stringMatching(/^https?:\/\//) });
      expect(link.headers['access-control-allow-origin']).toBe('*');
    }
    expect((await anon().post('/api/actions/go/elsewhere').send({ account: newWallet().address }).expect(400)).body).toEqual({ message: expect.any(String) });
  });

  it('a ride blink describes the shift and never says verified; an unknown id is 404 {message}', async () => {
    const w = await login();
    const ride = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body as { id: string };
    const card = await anon().get(`/api/actions/ride/${ride.id}`).expect(200);
    expect(card.body.type).toBe('action');
    expect(JSON.stringify(card.body).toLowerCase()).not.toContain('verified');
    expect(card.body.links.actions.some((a: { label: string }) => a.label === 'Open the ride')).toBe(true);
    for (const a of card.body.links.actions as { type: string; href: string }[]) {
      const link = await anon().post(a.href).send({ account: w.address, type: a.type }).expect(200);
      expect(link.body.type).toBe('external-link');
      expect(link.body.externalLink).toMatch(new RegExp(`/r/${ride.id}$`)); // a created free ride: the page, and no watch button
    }
    const watch = await anon().post(`/api/actions/ride/${ride.id}/watch`).send({ account: w.address }).expect(200);
    expect(watch.body.externalLink).toMatch(new RegExp(`/r/${ride.id}$`));
    const missing = await anon().get('/api/actions/ride/missing-ride').expect(404);
    expect(missing.body).toEqual({ message: expect.any(String) });
    expect(missing.headers['content-type']).not.toMatch(/problem\+json/);
  });
}

export function actionsBuyScenarios(h: () => Harness): void {
  const { anon, login, now } = bindClient(h);
  beforeEach(() => h().reset());
  const seed = () => h().app.get(PoolRepositoryPort, { strict: false }).upsert(aPool({ id: 1, tier: '1h', status: 'active', priceLamports: 50_000_000 }, new Date(now())));

  it('a wallet without the two stamps is refused; one that accepted them gets one ticket transaction', async () => {
    await seed();
    const stranger = newWallet();
    const refused = await anon().post('/api/actions/shift/1h').send({ account: stranger.address }).expect(409);
    expect(refused.body.message).toMatch(/18\+/);
    expect(refused.headers['content-type']).not.toMatch(/problem\+json/);
    const w = await login();
    const card = await anon().get('/api/actions/shift').expect(200);
    expect(card.body.links.actions[0]).toMatchObject({ type: 'transaction', href: '/api/actions/shift/1h' });
    const bought = await anon().post('/api/actions/shift').query({ tier: '1h' }).send({ account: w.address, data: { qty: '100' } }).expect(200);
    expect(bought.body.type).toBe('transaction');
    expect(bought.body.transaction.length).toBeGreaterThan(10);
    expect(bought.body.message).toMatch(/pool #1/);
    expect(bought.body.links.next.action.type).toBe('completed');
  });
}
