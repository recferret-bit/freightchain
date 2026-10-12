import { bindClient, newWallet } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/* The refactor's headline HTTP rules, through the REAL app (middleware → guard → pipe → handler → filter): every error is RFC 9457 problem+json that echoes the
   request id, every response carries X-Request-Id, the session cookie is httpOnly and cleared on sign-out, health answers. */
const PROBLEM = /application\/problem\+json/;

export function httpContractScenarios(h: () => Harness): void {
  const { anon, login } = bindClient(h);
  beforeEach(() => h().reset());

  it('an unknown /api route is a 404 problem+json that echoes the request id', async () => {
    const res = await anon().get('/api/nope').set('x-request-id', 'client-req-0001').expect(404);
    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.headers['x-request-id']).toBe('client-req-0001');
    expect(res.body).toMatchObject({ type: '/problems/not_found', status: 404, code: 'not_found', requestId: 'client-req-0001', instance: '/api/nope' });
  });

  it('a malformed JSON body is a 400 malformed_json problem', async () => {
    const res = await anon().post('/api/auth/nonce').set('content-type', 'application/json').send('{"wallet":').expect(400);
    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body).toMatchObject({ status: 400, code: 'malformed_json', detail: 'Request body is not valid JSON' });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('a validation error lists the failing fields', async () => {
    const a = await login();
    const res = await a.agent.post('/api/rides').send({ tier: 'platinum' }).expect(400);
    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body).toMatchObject({ status: 400, code: 'validation_error', errors: [{ path: 'tier' }] });
  });

  it('the reason of a validation error reaches the client in `detail`', async () => {
    const res = await anon().post('/api/auth/nonce').send({ wallet: 'hello' }).expect(400);
    expect(res.body).toMatchObject({ code: 'validation_error', detail: 'wallet must be a base58 Solana address', errors: [{ path: 'wallet' }] });
  });

  it('a missing session is a 401 problem+json', async () => {
    const res = await anon().get('/api/me').expect(401);
    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body).toMatchObject({ type: '/problems/unauthorized', status: 401, code: 'unauthorized', detail: 'not signed in' });
  });

  it('every SUCCESS response carries X-Request-Id too (the caller\'s when well-formed, otherwise a fresh one)', async () => {
    const own = await anon().get('/api/tiers').set('x-request-id', 'client-req-0002').expect(200);
    expect(own.headers['x-request-id']).toBe('client-req-0002');
    const fresh = await anon().get('/api/tiers').set('x-request-id', 'bad id!').expect(200);
    expect(fresh.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('the session cookie is httpOnly + SameSite=Lax, the body never carries the token, and logout clears it', async () => {
    const w = newWallet();
    const agent = anon();
    const { body: ch } = await agent.post('/api/auth/nonce').send({ wallet: w.address }).expect(200);
    const { sign } = await import('../support/client.js');
    const res = await agent.post('/api/auth/verify').send({ wallet: w.address, signature: sign(w.kp, ch.message) }).expect(200);
    const cookie = String(res.headers['set-cookie']?.[0]);
    expect(cookie).toMatch(/^fc_session=[^;]+; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax/);
    expect(JSON.stringify(res.body)).not.toContain(cookie.split(';')[0]?.split('=')[1] ?? 'x');
    expect(Object.keys(res.body).sort()).toEqual(['agreements', 'createdAt', 'demo', 'demoScale', 'freeRides', 'freeRidesMax', 'nextFreeRideAt', 'readyFreeRide', 'sns', 'tickets', 'tutorialPassed', 'wallet']);
    const rider = await login(w);
    const out = await rider.agent.post('/api/auth/logout').expect(200);
    expect(out.body).toEqual({ ok: true });
    expect(String(out.headers['set-cookie']?.[0])).toMatch(/^fc_session=;.*Expires=Thu, 01 Jan 1970/);
  });

  it('a forged session cookie is refused', async () => {
    const res = await anon().get('/api/me').set('Cookie', 'fc_session=eyJhbGciOiJIUzI1NiJ9.e30.forged').expect(401);
    expect(res.body).toMatchObject({ code: 'unauthorized', detail: 'session expired' });
  });

  it('liveness and readiness answer (readiness pings the database)', async () => {
    expect((await anon().get('/api/health/live').expect(200)).body).toEqual({ status: 'ok' });
    expect((await anon().get('/api/health/ready').expect(200)).body).toMatchObject({ status: 'ok', checks: { database: { status: 'up' } } });
  });
}
