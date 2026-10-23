import { ADMIN } from './admin.scenarios.js';
import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/* Each route below had zero scenario cases, or the minigame answer had one.
   Two `it`s call the path as a literal so the census counts both. */

const RIDE = 'missing-ride';

export function wave6GapScenarios(h: () => Harness): void {
  const { anon, login, loginAdmin } = bindClient(h);
  beforeEach(() => h().reset());

  it('anonymous callers are refused on the wave-6 routes', async () => {
    await anon().get('/api/admin/appeals').expect(404);
    await anon().post('/api/admin/appeals/missing/challenge').send({}).expect(404);
    await anon().post('/api/admin/appeals/missing').send({}).expect(404);
    await anon().post('/api/admin/chat/1/hide').send({}).expect(404);
    await anon().post(`/api/admin/players/${ADMIN.address}/chat-ban`).send({ ban: true }).expect(404);
    await anon().post(`/api/admin/wallets/${ADMIN.address}/chat-ban`).send({ ban: true }).expect(404);
    await anon().post('/api/admin/pools/rules').send({ poolId: 1, note: null }).expect(404);
    await anon().post('/api/admin/config').send({ note: null }).expect(404);
    await anon().post('/api/admin/proposals/00000000-0000-4000-8000-000000000001/approve').send({}).expect(404);
    await anon().get('/api/pools/current').expect(200);
    await anon().get('/api/pools/1/results').expect(404);
    await anon().post('/api/tickets/orders').send({ poolId: 1, qty: 1 }).expect(401);
    await anon().post(`/api/live/rides/${RIDE}/pledge-intent`).send({ lamportsPerKm: 1000, targetKm: 1 }).expect(401);
    await anon().post(`/api/live/rides/${RIDE}/pledge-confirm`).send({ pledgeId: 'x', signature: 'abc' }).expect(401);
    await anon().get('/api/me/donations').expect(401);
    await anon().get('/api/airdrop/status').expect(401);
    await anon().post('/api/airdrop/verify-telegram').send({ telegramUserId: '1' }).expect(401);
    await anon().post('/api/airdrop/verify-x').send({ handle: 'a', postId: '1' }).expect(401);
    await anon().post('/api/airdrop/claim').send({}).expect(401);
    await anon().get('/api/referrals/leaderboard').expect(401);
    await anon().post('/api/referrals/convoy/bind').send({ code: 'AAAAAAAA' }).expect(401);
    await anon().patch('/api/me/privacy').send({ convoyHidden: true }).expect(401);
    await anon().get(`/api/rides/${RIDE}/card.png`).expect(404);
    await anon().post(`/api/rides/${RIDE}/appeal`).send({ reason: 'late' }).expect(401);
    await anon().get('/api/rides/missing-ride/minigames/bbbbbbbbbbbbbbbb/assets/aaaaaaaaaaaaaaaa').expect(401);
    await anon().post('/api/rides/missing-ride/minigames/bbbbbbbbbbbbbbbb/answer').send({ mac: 'a'.repeat(43), nonce: 'b'.repeat(16), attempt: 1, answer: '1' }).expect(401);
  });

  it('a rider is still refused on admin routes, and a bad player body is 400', async () => {
    const rider = await login();
    await rider.agent.get('/api/admin/appeals').set('x-fc-admin', '1').expect(404);
    await rider.agent.post('/api/admin/appeals/missing/challenge').set('x-fc-admin', '1').send({ decision: 'denied', note: null }).expect(404);
    await rider.agent.post('/api/admin/appeals/missing').set('x-fc-admin', '1').send({ decision: 'denied', note: null, signature: 'abc' }).expect(404);
    await rider.agent.post('/api/admin/chat/1/hide').set('x-fc-admin', '1').expect(404);
    await rider.agent.post(`/api/admin/players/${ADMIN.address}/chat-ban`).set('x-fc-admin', '1').send({ ban: true }).expect(404);
    await rider.agent.post(`/api/admin/wallets/${ADMIN.address}/chat-ban`).set('x-fc-admin', '1').send({ ban: true }).expect(404);
    await rider.agent.post('/api/admin/pools/rules').set('x-fc-admin', '1').send({ poolId: 1, note: null }).expect(404);
    await rider.agent.post('/api/admin/config').set('x-fc-admin', '1').send({ note: null }).expect(404);
    await rider.agent.post('/api/admin/proposals/00000000-0000-4000-8000-000000000001/approve').set('x-fc-admin', '1').expect(404);
    expect((await rider.agent.get('/api/pools/current').expect(200)).body.pool).toBeNull();
    await rider.agent.get('/api/pools/1/results').expect(404);
    await rider.agent.post('/api/tickets/orders').send({}).expect(400);
    await rider.agent.post(`/api/live/rides/${RIDE}/pledge-intent`).send({}).expect(400);
    await rider.agent.post(`/api/live/rides/${RIDE}/pledge-confirm`).send({}).expect(400);
    expect((await rider.agent.get('/api/me/donations').expect(200)).body).toEqual({ sent: [], received: [], totals: { sentLamports: 0, receivedLamports: 0 } });
    expect((await rider.agent.get('/api/airdrop/status').expect(200)).body.campaign).toBe('preseason');
    await rider.agent.post('/api/airdrop/verify-telegram').send({}).expect(400);
    await rider.agent.post('/api/airdrop/verify-x').send({}).expect(400);
    await rider.agent.post('/api/airdrop/claim').send({ extra: true }).expect(400);
    expect(Array.isArray((await rider.agent.get('/api/referrals/leaderboard').expect(200)).body.rows)).toBe(true);
    await rider.agent.post('/api/referrals/convoy/bind').send({ code: 'no' }).expect(400);
    expect((await rider.agent.patch('/api/me/privacy').send({ convoyHidden: false }).expect(200)).body.convoyHidden).toBe(false);
    await rider.agent.get(`/api/rides/${RIDE}/card.png`).expect(404);
    await rider.agent.post(`/api/rides/${RIDE}/appeal`).send({}).expect(400);
    await rider.agent.get('/api/rides/missing-ride/minigames/bbbbbbbbbbbbbbbb/assets/aaaaaaaaaaaaaaaa').expect(404);
    await rider.agent.post('/api/rides/missing-ride/minigames/bbbbbbbbbbbbbbbb/answer').send({}).expect(400);
  });

  it('an admin session can list appeals, and a change without the header is 403', async () => {
    const admin = await loginAdmin(ADMIN);
    expect((await admin.agent.get('/api/admin/appeals').expect(200)).body.appeals).toEqual([]);
    await admin.agent.post('/api/admin/appeals/missing/challenge').send({ decision: 'denied', note: null }).expect(403);
    await admin.agent.post('/api/admin/appeals/missing/challenge').set('x-fc-admin', '1').send({}).expect(400);
    await admin.agent.post('/api/admin/appeals/missing').send({ decision: 'denied', note: null, signature: 'abc' }).expect(403);
    await admin.agent.post('/api/admin/chat/1/hide').send({}).expect(403);
    await admin.agent.post(`/api/admin/players/${ADMIN.address}/chat-ban`).send({ ban: true }).expect(403);
    await admin.agent.post(`/api/admin/wallets/${ADMIN.address}/chat-ban`).send({ ban: true }).expect(403);
    await admin.agent.post('/api/admin/pools/rules').send({ poolId: 1, note: null }).expect(403);
    await admin.agent.post('/api/admin/config').send({ note: null }).expect(403);
    await admin.agent.post('/api/admin/proposals/00000000-0000-4000-8000-000000000001/approve').expect(403);
    const hidden = await admin.agent.post('/api/admin/chat/1/hide').set('x-fc-admin', '1').expect(200);
    expect(hidden.body.ok).toBe(true);
  });
}
