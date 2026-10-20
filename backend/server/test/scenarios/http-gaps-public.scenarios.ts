import request from 'supertest';
import { DEVNET_BLOCKCHAIN_ID } from '../../src/domain/actions/action-card.js';
import { bindClient, newWallet } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/* Zero-scenario and single-scenario public / auth / blink routes.
   Action errors are `{ message }`. A guest is a real session. SNS misses are null, not 500.
   GET /api/rides/:id/pledges for an unknown id is 200 [] (as-built, not 404). */

const LONG = 'x'.repeat(65);

export function publicGapScenarios(h: () => Harness): void {
  const { anon, login, server } = bindClient(h);
  beforeEach(() => h().reset());

  it('a guest session is a rider cookie with guest: true and can read /me', async () => {
    const agent = request.agent(server());
    const res = await agent.post('/api/auth/guest').expect(200);
    expect(res.body.guest).toBe(true);
    expect(res.body.wallet).toEqual(expect.any(String));
    expect(String(res.headers['set-cookie'])).toMatch(/fc_session=/);
    expect((await agent.get('/api/me').expect(200)).body.guest).toBe(true);
  });

  it('guest refuses a null Origin and a non-JSON body', async () => {
    expect((await anon().post('/api/auth/guest').set('Origin', 'null').expect(403)).body.code).toBe('bad_origin');
    expect((await anon().post('/api/auth/guest').set('Content-Type', 'text/plain').send('x').expect(415)).body.code).toBe('json_only');
  });

  it('logout refuses a null Origin and a non-JSON body; a second logout is still ok', async () => {
    const rider = await login();
    expect((await rider.agent.post('/api/auth/logout').set('Origin', 'null').expect(403)).body.code).toBe('bad_origin');
    expect((await anon().post('/api/auth/logout').set('Content-Type', 'text/plain').send('x').expect(415)).body.code).toBe('json_only');
    await rider.agent.post('/api/auth/logout').expect(200);
    expect((await rider.agent.post('/api/auth/logout').expect(200)).body).toEqual({ ok: true });
  });

  it('pairing refuses a null Origin and a non-JSON body', async () => {
    expect((await anon().post('/api/auth/pair').set('Origin', 'null').expect(403)).body.code).toBe('bad_origin');
    expect((await anon().post('/api/auth/pair').set('Content-Type', 'text/plain').send('x').expect(415)).body.code).toBe('json_only');
  });

  it('a pair id that is not 32 hex is 400; an unknown id without the secret cookie is 404', async () => {
    await anon().get('/api/auth/pair/abc').expect(400);
    await anon().get('/api/auth/pair/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').expect(404);
    const rider = await login();
    await anon().post('/api/auth/pair/abc/claim').expect(401);
    await rider.agent.post('/api/auth/pair/abc/claim').expect(400);
    expect((await rider.agent.post('/api/auth/pair/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim').expect(404)).body.code).toBe('pair_expired');
  });

  it('discovery is GET /actions.json with blink CORS; a bad shift tier is {message}', async () => {
    const file = await anon().get('/actions.json').expect(200);
    expect(file.body.rules).toEqual(expect.arrayContaining([{ pathPattern: '/', apiPath: '/api/actions/shift' }]));
    expect(file.headers['access-control-allow-origin']).toBe('*');
    expect(file.headers['x-blockchain-ids']).toBe(DEVNET_BLOCKCHAIN_ID);
    const card = await anon().get('/api/actions/shift/1h').expect(200);
    expect(card.body).toMatchObject({ type: 'action', title: 'Freight Chain' });
    expect(card.body.description).toMatch(/No paid pool is on sale right now/);
    expect(card.headers['access-control-allow-origin']).toBe('*');
    const bad = await anon().get('/api/actions/shift/9h').expect(400);
    expect(bad.body).toEqual({ message: expect.any(String) });
    expect(bad.headers['content-type']).not.toMatch(/problem\+json/);
  });

  it('hello and the site link refuse a bad account with {message}', async () => {
    expect((await anon().post('/api/actions/hello').send({}).expect(400)).body).toEqual({ message: expect.any(String) });
    expect((await anon().post('/api/actions/hello').send({ account: 'nope' }).expect(400)).body).toEqual({ message: expect.stringMatching(/Solana account/) });
    expect((await anon().post('/api/actions/shift').send({ account: newWallet().address }).expect(400)).body).toEqual({ message: expect.any(String) });
    expect((await anon().post('/api/actions/go/home').send({ account: 'nope' }).expect(400)).body).toEqual({ message: expect.any(String) });
    expect((await anon().post('/api/actions/go/home').send({}).expect(400)).body).toEqual({ message: expect.any(String) });
    const home = await anon().post('/api/actions/go/home').send({ account: newWallet().address }).expect(200);
    expect(home.body.type).toBe('external-link');
  });

  it('POST /api/actions/ride/:id opens the page; a bad account is 400 and an unknown id is 404 {message}', async () => {
    const rider = await login();
    const ride = (await rider.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body as { id: string };
    const link = await anon().post(`/api/actions/ride/${ride.id}`).send({ account: rider.address }).expect(200);
    expect(link.body).toMatchObject({ type: 'external-link', externalLink: expect.stringMatching(new RegExp(`/r/${ride.id}$`)) });
    expect(link.headers['access-control-allow-origin']).toBe('*');
    expect((await anon().post(`/api/actions/ride/${ride.id}`).send({ account: 'nope' }).expect(400)).body).toEqual({ message: expect.any(String) });
    const missing = await anon().post('/api/actions/ride/missing-ride').send({ account: rider.address }).expect(404);
    expect(missing.body).toEqual({ message: expect.any(String) });
    expect(missing.headers['content-type']).not.toMatch(/problem\+json/);
    await anon().get(`/api/actions/ride/${LONG}`).expect(400);
    expect((await anon().post(`/api/actions/ride/${ride.id}/watch`).send({}).expect(400)).body).toEqual({ message: expect.any(String) });
    expect((await anon().post('/api/actions/ride/missing-ride/watch').send({ account: rider.address }).expect(404)).body).toEqual({ message: expect.any(String) });
  });

  it('the prize board is public for a paid tier and 400 without one', async () => {
    const board = await anon().get('/api/prize/board').query({ tier: '1h' }).expect(200);
    expect(board.body).toMatchObject({ tier: '1h', board: [] });
    expect(board.body.weekId).toEqual(expect.any(String));
    await anon().get('/api/prize/board').expect(400);
    await anon().get('/api/prize/board').query({ tier: 'free' }).expect(400);
  });

  it('SNS resolve and reverse return the stub name, and a miss is null', async () => {
    const w = newWallet();
    h().nameService.setRecord('bonfida.sol', w.address);
    expect((await anon().get('/api/sns/resolve').query({ domain: 'BONFIDA.SOL' }).expect(200)).body).toEqual({ domain: 'bonfida.sol', wallet: w.address });
    expect((await anon().get('/api/sns/resolve').query({ domain: 'missing.sol' }).expect(200)).body).toEqual({ domain: 'missing.sol', wallet: null });
    expect((await anon().get('/api/sns/reverse').query({ wallet: w.address }).expect(200)).body).toEqual({ wallet: w.address, domain: 'bonfida.sol' });
    expect((await anon().get('/api/sns/reverse').query({ wallet: newWallet().address }).expect(200)).body.domain).toBeNull();
  });

  it('SNS rejects a missing or illegal name and a wallet that is not an address', async () => {
    expect((await anon().get('/api/sns/resolve').expect(400)).body.code).toBe('validation_error');
    expect((await anon().get('/api/sns/resolve').query({ domain: 'not a domain' }).expect(400)).body.code).toBe('invalid_domain');
    expect((await anon().get('/api/sns/reverse').expect(400)).body.code).toBe('validation_error');
    await anon().get('/api/sns/reverse').query({ wallet: 'nope' }).expect(400);
  });

  it('a public ride is readable with no session; a missing id is 404 and a huge id is 400', async () => {
    const rider = await login();
    const ride = (await rider.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body as { id: string; seed: number };
    const body = (await anon().get(`/api/rides/${ride.id}/public`).expect(200)).body;
    expect(body).toMatchObject({ id: ride.id, tier: 'free', status: 'created', seed: ride.seed, fullWallet: rider.address, sns: null });
    expect(body.wallet).not.toBe(rider.address);
    expect((await anon().get('/api/rides/missing-ride/public').expect(404)).body.code).toBe('ride_not_found');
    await anon().get(`/api/rides/${LONG}/public`).expect(400);
  });

  it('pledges of an unknown ride are an empty list; only a too-long id is 400', async () => {
    expect((await anon().get('/api/rides/missing-ride/pledges').expect(200)).body).toEqual([]);
    await anon().get(`/api/rides/${LONG}/pledges`).expect(400);
    const rider = await login();
    const ride = (await rider.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body as { id: string };
    expect((await anon().get(`/api/rides/${ride.id}/pledges`).expect(200)).body).toEqual([]);
  });

  it('daily stats and the honk catalogue are public; a gift needs a session and a real colour', async () => {
    expect((await anon().get('/api/stats/daily').expect(200)).body).toEqual([]);
    const catalog = (await anon().get('/api/honk/catalog').expect(200)).body as { slot: string; isDefault: boolean }[];
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.some((row) => row.isDefault)).toBe(true);
    await anon().get('/api/honk').expect(401);
    await anon().post('/api/referrals/gift').send({ item: 'signal' }).expect(401);
    const rider = await login();
    expect((await rider.agent.post('/api/referrals/gift').send({ item: 'amber' }).expect(200)).body.gift).toBe('amber');
    await rider.agent.post('/api/referrals/gift').send({ item: 'red' }).expect(400);
    await rider.agent.post('/api/referrals/gift').send({}).expect(400);
    expect((await anon().get('/api/health/ready').expect(200)).body).toMatchObject({ status: 'ok', checks: { database: { status: 'up' } } });
  });

  it('the public replay list rejects a bad cursor and an unknown status', async () => {
    await anon().get('/api/replays').query({ before: 'yesterday' }).expect(400);
    await anon().get('/api/replays').query({ limit: 0 }).expect(400);
    expect((await anon().get('/api/replays').expect(200)).body.rows).toEqual([]);
  });

  it('a ride Solana Pay POST refuses a bad account and an unknown ride', async () => {
    await anon().post('/api/solana-pay/rides/missing-ride').send({ account: 'nope' }).expect(400);
    expect((await anon().post('/api/solana-pay/rides/missing-ride').send({ account: newWallet().address }).expect(404)).body.code).toBe('not_found');
    await anon().post('/api/solana-pay/rides/missing-ride').send({}).expect(400);
  });
}
