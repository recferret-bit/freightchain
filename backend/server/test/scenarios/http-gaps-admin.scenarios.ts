import { ADMIN } from './admin.scenarios.js';
import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/* Census singles on /api/admin: a second and third `it` so each route is no longer one scenario.
   As-built refusal is 404 (no admin session — not 401) and 403 only when the session exists but X-FC-Admin is missing. */

const READS = [
  '/api/admin/queue/count', '/api/admin/players', '/api/admin/pools', '/api/admin/pools/1',
  '/api/admin/stats', '/api/admin/sessions', '/api/admin/pool-payouts', '/api/admin/replays', '/api/admin/logs',
] as const;

export function adminGapScenarios(h: () => Harness): void {
  const { anon, login, loginAdmin } = bindClient(h);
  beforeEach(() => h().reset());

  it('admin reads and signed changes do not exist without an admin session (404, not 401)', async () => {
    for (const path of READS) await anon().get(path).expect(404);
    await anon().post('/api/admin/pools/1/hold/challenge').send({ action: 'pool_hold', hold: true, note: null }).expect(404);
    await anon().post('/api/admin/pools/1/hold').send({ hold: true, note: null, signature: 'abc' }).expect(404);
    await anon().post('/api/admin/players/free-rides/challenge').send({ action: 'free_rides_adjust', wallet: ADMIN.address, delta: 1 }).expect(404);
    await anon().post('/api/admin/rides/missing-ride/rejudge').send({ signature: 'abc' }).expect(404);
    await anon().post('/api/admin/auth/logout').expect(403); // public route: the header, not the session
  });

  it('a rider session, even with the admin header, is still 404 on the directory and the signed changes', async () => {
    const rider = await login();
    for (const path of READS) await rider.agent.get(path).set('x-fc-admin', '1').expect(404);
    await rider.agent.post('/api/admin/pools/1/hold/challenge').set('x-fc-admin', '1').send({ action: 'pool_hold', hold: true, note: null }).expect(404);
    await rider.agent.post('/api/admin/pools/1/hold').set('x-fc-admin', '1').send({ hold: true, note: null, signature: 'abc' }).expect(404);
    await rider.agent.post('/api/admin/players/free-rides/challenge').set('x-fc-admin', '1').send({ action: 'free_rides_adjust', wallet: rider.address, delta: 1 }).expect(404);
    await rider.agent.post('/api/admin/rides/missing-ride/rejudge').set('x-fc-admin', '1').send({ signature: 'abc' }).expect(404);
    await rider.agent.post('/api/admin/auth/logout').set('x-fc-admin', '1').expect(200); // AdminPublic: any caller with the header
    await rider.agent.get('/api/admin/overview').expect(404);
  });

  it('with a session, a bad query or body is 400 and a change without the header is 403', async () => {
    const admin = await loginAdmin(ADMIN);
    await admin.agent.get('/api/admin/players').query({ q: '***' }).expect(400);
    await admin.agent.get('/api/admin/pools/x').expect(400);
    await admin.agent.get('/api/admin/pools/3000000000').expect(400);
    await admin.agent.get('/api/admin/stats').query({ days: 0 }).expect(400);
    await admin.agent.get('/api/admin/sessions').query({ days: 99 }).expect(400);
    await admin.agent.get('/api/admin/replays').query({ status: 'running' }).expect(400);
    await admin.agent.get('/api/admin/logs').query({ level: 'nope' }).expect(400);
    await admin.agent.get('/api/admin/queue/count').expect(200);
    await admin.agent.get('/api/admin/pool-payouts').expect(200);
    await admin.agent.post('/api/admin/pools/1/hold/challenge').send({ action: 'pool_hold', hold: true, note: null }).expect(403);
    await admin.agent.post('/api/admin/pools/1/hold/challenge').set('x-fc-admin', '1').send({ hold: true }).expect(400);
    await admin.agent.post('/api/admin/pools/1/hold').send({ hold: true, note: null, signature: 'abc' }).expect(403);
    await admin.agent.post('/api/admin/pools/1/hold').set('x-fc-admin', '1').send({ hold: true }).expect(400);
    await admin.agent.post('/api/admin/players/free-rides/challenge').send({ action: 'free_rides_adjust', wallet: ADMIN.address, delta: 1 }).expect(403);
    await admin.agent.post('/api/admin/players/free-rides/challenge').set('x-fc-admin', '1').send({ action: 'free_rides_adjust', wallet: 'nope', delta: 1 }).expect(400);
    await admin.agent.post('/api/admin/rides/missing-ride/rejudge').send({ signature: 'abc' }).expect(403);
    await admin.agent.post('/api/admin/rides/missing-ride/rejudge').set('x-fc-admin', '1').send({}).expect(400);
    const unsigned = await admin.agent.post('/api/admin/rides/missing-ride/rejudge').set('x-fc-admin', '1').send({ signature: 'abc' }).expect(401);
    expect(unsigned.body.code).toBe('unauthorized');
    await admin.agent.post('/api/admin/auth/logout').expect(403);
  });
}
