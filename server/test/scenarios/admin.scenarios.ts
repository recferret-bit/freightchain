import { bindClient, newWallet, sign, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import { setTierOnSaleForTest } from '../../src/domain/rides/ride-tier.js';
import { aPool } from '../support/pools.js';
import { recording, upload } from '../support/recording.js';

/* The admin surface (/api/admin/*): invisible to everyone but ADMIN_WALLETS, the review queue, an audited override, sign-ins, the log ring.
   Same scenarios on in-memory and PostgreSQL. A free shift = 10 s / 140 m. */
export const ADMIN = newWallet();
/** a demo rider: its paid 1 h shift is 60 s (DEMO_SCALE), short enough to complete here */
export const ADMIN_DEMO_RIDER = newWallet();
export const ADMIN_ENV = { FREE_RIDE_SECONDS: '10', ADMIN_WALLETS: ADMIN.address, DEMO_WALLETS: ADMIN_DEMO_RIDER.address };

export function adminScenarios(h: () => Harness): void {
  const { anon, login, loginAdmin, sec } = bindClient(h);
  /** the admin as on the site: signed in as a rider (landing) AND on the admin page (the admin sign-in) */
  const asAdmin = async () => loginAdmin(ADMIN, (await login(ADMIN)).agent);
  beforeEach(() => h().reset());

  /** the admin page's signed change: ask for the text, the wallet signs it, the change carries the signature */
  async function signed(admin: Rider, rideId: string, intent: { action: 'override'; decision: string; note?: string } | { action: 'rejudge' }) {
    const { body } = await admin.agent.post(`/api/admin/rides/${rideId}/challenge`).set('x-fc-admin', '1').send(intent).expect(200);
    return { message: body.message as string, signature: sign(admin.kp, body.message) };
  }
  /** a completed free shift whose recording covers only 7 of its 10 s → flagged ('recording-gaps') */
  async function flaggedRide(rider: Rider) {
    const r = (await rider.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await rider.agent.post(`/api/rides/${r.id}/start`).expect(200);
    await upload(rider.agent, r.id, recording(r.id, { seconds: 7, distance: 140, batchSeconds: 5 }));
    sec(10);
    const end = (await rider.agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'shift', s: 140, t: 10 }).expect(200)).body;
    expect(end.verdict).toMatchObject({ status: 'flagged', reasons: [{ code: 'recording-gaps', severity: 'flag' }] });
    return r.id as string;
  }

  it('does not exist for anyone but an admin: signed out, a rider, even with the header → 404 on every route', async () => {
    const rider = await login();
    for (const path of ['overview', 'rides', 'replays', 'rides/x', 'signins', 'actions', 'logs', 'settings', 'queue/count', 'players', `players/${rider.address}`, 'pools', 'pools/1', 'pool-payouts', 'stats', 'sessions']) {
      await anon().get(`/api/admin/${path}`).expect(404);
      await rider.agent.get(`/api/admin/${path}`).set('x-fc-admin', '1').expect(404);
    }
    await rider.agent.post('/api/admin/rides/x/verdict').set('x-fc-admin', '1').send({ decision: 'verified', signature: 's' }).expect(404);
    for (const [path, body] of [
      ['/api/admin/settings/challenge', { action: 'setting_update', key: 'free_on_signup', value: 1 }],
      ['/api/admin/settings', { key: 'free_on_signup', value: 1, signature: 's' }],
      ['/api/admin/players/free-rides/challenge', { action: 'free_rides_adjust', wallet: rider.address, delta: 1 }],
      ['/api/admin/players/free-rides', { wallet: rider.address, delta: 1, signature: 's' }],
    ] as const) {
      await anon().post(path).set('x-fc-admin', '1').send(body).expect(404);
      await rider.agent.post(path).set('x-fc-admin', '1').send(body).expect(404);
    }
  });

  it('the admin session: the player session of an admin wallet grants nothing; the admin sign-in does, for ADMIN_SESSION_TTL_MINUTES (120); sign-out ends it', async () => {
    const player = await login(ADMIN);
    await player.agent.get('/api/admin/overview').expect(404);   // the rider cookie of an admin wallet is no admin session
    const stranger = newWallet();
    await anon().post('/api/admin/auth/nonce').set('x-fc-admin', '1').send({ wallet: stranger.address }).expect(404);
    await anon().post('/api/admin/auth/nonce').send({ wallet: ADMIN.address }).expect(403);   // the header, like every admin POST

    const admin = await loginAdmin(ADMIN);
    expect((await admin.agent.get('/api/admin/overview').expect(200)).body.players).toBe(1);
    const audit = (await admin.agent.get('/api/admin/actions').expect(200)).body.rows;
    expect(audit[0]).toMatchObject({ wallet: ADMIN.address, action: 'auth.signin', target: ADMIN.address });
    await anon().get('/api/me').set('Cookie', `fc_admin=${'x'}`).expect(401);   // and an admin cookie is no player session

    sec(120 * 60 - 1); await admin.agent.get('/api/admin/overview').expect(200);
    sec(2); await admin.agent.get('/api/admin/overview').expect(404);   // expired: sign in again

    const again = await loginAdmin(ADMIN);
    await again.agent.post('/api/admin/auth/logout').set('x-fc-admin', '1').expect(200);
    await again.agent.get('/api/admin/overview').expect(404);
  });

  it('the admin sign-in: a wrong signature or a replayed one is a 401, the RIDER message signed is no admin sign-in', async () => {
    const agent = anon();
    const { body } = await agent.post('/api/admin/auth/nonce').set('x-fc-admin', '1').send({ wallet: ADMIN.address }).expect(200);
    expect(body.message).toContain('ADMIN sign-in to Freight Chain');
    await anon().post('/api/admin/auth/verify').set('x-fc-admin', '1').send({ wallet: ADMIN.address, signature: sign(newWallet().kp, body.message) }).expect(401);
    await anon().post('/api/admin/auth/verify').set('x-fc-admin', '1').send({ wallet: ADMIN.address, signature: sign(ADMIN.kp, body.message) }).expect(401);   // consumed by the failed try
    const rider = (await anon().post('/api/auth/nonce').send({ wallet: ADMIN.address }).expect(200)).body;
    await anon().post('/api/admin/auth/verify').set('x-fc-admin', '1').send({ wallet: ADMIN.address, signature: sign(ADMIN.kp, rider.message) }).expect(401);
  });

  it('overview: counts, sign-ins of the last day, the verified-play switches', async () => {
    const admin = await asAdmin();
    const rider = await login();
    await flaggedRide(rider);
    const o = (await admin.agent.get('/api/admin/overview').expect(200)).body;
    expect(o).toMatchObject({ players: 2, signIns24h: 2, rides: { completed: 1 }, verdicts: { flagged: 1 }, config: { verdictEnforce: true, telemetryRetentionDays: 90 } });
    expect(o.telemetry.batches).toBe(2);
  });

  it('the review queue → one ride in full → an override (needs X-FC-Admin), audited and findable in the log by its request id', async () => {
    const admin = await asAdmin();
    const rider = await login();
    const id = await flaggedRide(rider);
    const queue = (await admin.agent.get('/api/admin/rides?verdict=flagged').expect(200)).body.rows;
    expect(queue).toEqual([expect.objectContaining({ id, wallet: rider.address, status: 'completed', verdict: 'flagged', overridden: false })]);
    const detail = (await admin.agent.get(`/api/admin/rides/${id}`).expect(200)).body;
    expect(detail.verdict.reasons[0].code).toBe('recording-gaps');
    expect(detail.replays).toHaveLength(1);
    expect(detail.replays[0]).toMatchObject({ rideId: id, seq: 1, simHz: 10 });
    const replaysList = (await admin.agent.get('/api/admin/replays').expect(200)).body;
    expect(replaysList.rows[0]).toMatchObject({ rideId: id, seq: 1 });
    expect(detail.batches.map((b: { seq: number }) => b.seq)).toEqual([0, 1]);

    const refused = await admin.agent.post(`/api/admin/rides/${id}/verdict`).send({ decision: 'verified' }).expect(403);
    expect(refused.body.code).toBe('forbidden');
    await admin.agent.post(`/api/admin/rides/${id}/verdict`).set('x-fc-admin', '1').send({ decision: 'maybe' }).expect(400);
    const unsigned = await admin.agent.post(`/api/admin/rides/${id}/verdict`).set('x-fc-admin', '1').send({ decision: 'verified', signature: sign(ADMIN.kp, 'whatever') }).expect(401);   // nothing was issued
    expect(unsigned.body.code).toBe('unauthorized');
    const wrong = await signed(admin, id, { action: 'override', decision: 'rejected' });   // signed for REJECT, sent as ACCEPT
    await admin.agent.post(`/api/admin/rides/${id}/verdict`).set('x-fc-admin', '1').send({ decision: 'verified', signature: wrong.signature }).expect(401);
    const proof = await signed(admin, id, { action: 'override', decision: 'verified', note: ' the tab was hidden for 3 s ' });
    expect(proof.message).toContain(`Ride: ${id}\nNote: "the tab was hidden for 3 s"`);
    const ok = await admin.agent.post(`/api/admin/rides/${id}/verdict`).set('x-fc-admin', '1').send({ decision: 'verified', note: 'the tab was hidden for 3 s', signature: proof.signature }).expect(200);
    await admin.agent.post(`/api/admin/rides/${id}/verdict`).set('x-fc-admin', '1').send({ decision: 'verified', note: 'the tab was hidden for 3 s', signature: proof.signature }).expect(401);   // a replay
    expect(ok.body).toMatchObject({ status: 'verified', override: { by: ADMIN.address, note: 'the tab was hidden for 3 s' } });
    const requestId = ok.headers['x-request-id'];

    expect((await rider.agent.get(`/api/rides/${id}`).expect(200)).body.verdict).toMatchObject({ status: 'verified', override: { by: ADMIN.address } });
    expect((await admin.agent.get('/api/admin/rides?verdict=flagged').expect(200)).body.rows).toEqual([]);
    const audit = (await admin.agent.get('/api/admin/actions').expect(200)).body.rows;
    expect(audit[0]).toMatchObject({ wallet: ADMIN.address, action: 'verdict.override', target: id, detail: { from: 'flagged', to: 'verified', rider: rider.address, signed: proof }, requestId });
    const log = (await admin.agent.get(`/api/admin/logs?q=${requestId}`).expect(200)).body.entries;
    expect(log.map((e: { event?: string }) => e.event)).toEqual(expect.arrayContaining(['request', 'admin']));

    sec(1); // the rider's late final batch re-judges the ride – the admin's decision stays
    await rider.agent.post(`/api/rides/${id}/batches`).send(recording(id, { seconds: 10, distance: 140, batchSeconds: 5 })[1]).expect(200);
    expect((await admin.agent.get(`/api/admin/rides/${id}`).expect(200)).body.verdict).toMatchObject({ status: 'verified', override: { by: ADMIN.address } });
  });

  /** a completed demo paid 1 h shift (60 s, 910 m) with NO recording – the machine rejects it ('no-recording') */
  async function paidShiftWithoutRecording(rider: Rider) {
    setTierOnSaleForTest('1h', true);   // the pay-per-ride order; production leaves 1h off until a pool exists
    const r = await rider.agent.post('/api/rides').send({ tier: '1h' }).expect(200).then((res) => res.body).finally(() => setTierOnSaleForTest('1h', false));
    const signature = h().chain.addPayment({ payer: rider.address, lamports: r.lamports, memo: r.id });
    await rider.agent.post(`/api/rides/${r.id}/confirm`).send({ signature }).expect(200);
    await rider.agent.post(`/api/rides/${r.id}/start`).expect(200);
    for (let i = 1; i <= 7; i++) { sec(10); await rider.agent.post(`/api/rides/${r.id}/heartbeat`).send({ s: (i * 910) / 7, t: i * 10, hull: 100 }).expect(200); }
    return (await rider.agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'shift', s: 910, t: 70, hull: 100 }).expect(200)).body;
  }

  it('every PAID ride waits for review: a machine-rejected one is UNDER REVIEW for the rider and in the queue (paid first) until the admin decides', async () => {
    const admin = await asAdmin();
    const rider = await login(ADMIN_DEMO_RIDER);
    const freeFlagged = await flaggedRide(rider);
    sec(1);
    const end = await paidShiftWithoutRecording(rider);
    expect(end).toMatchObject({ status: 'completed', tier: '1h', verdict: { status: 'rejected', reasons: [{ code: 'no-recording' }] }, review: 'under_review' });
    const queue = (await admin.agent.get('/api/admin/rides?review=under_review').expect(200)).body.rows;
    expect(queue.map((r: { id: string; review: string | null; poolId: number | null }) => [r.id, r.review, r.poolId])).toEqual([[end.id, 'under_review', null], [freeFlagged, null, null]]);
    expect((await admin.agent.get('/api/admin/overview').expect(200)).body.underReview).toBe(2);
    expect((await admin.agent.get('/api/admin/rides?review=under_review&pool=3').expect(200)).body.rows).toEqual([]);
    await admin.agent.get('/api/admin/rides?review=maybe').expect(400);
    await admin.agent.get('/api/admin/rides?pool=-1').expect(400);

    const proof = await signed(admin, end.id, { action: 'override', decision: 'rejected', note: 'no recording at all' });
    await admin.agent.post(`/api/admin/rides/${end.id}/verdict`).set('x-fc-admin', '1').send({ decision: 'rejected', note: 'no recording at all', signature: proof.signature }).expect(200);
    expect((await rider.agent.get(`/api/rides/${end.id}`).expect(200)).body).toMatchObject({ verdict: { status: 'rejected', override: { by: ADMIN.address } }, review: 'rejected' });
    expect((await rider.agent.get('/api/profile').expect(200)).body.recent[0]).toMatchObject({ tier: '1h', verdict: 'rejected', review: 'rejected' });
    expect((await admin.agent.get('/api/admin/rides?review=under_review').expect(200)).body.rows.map((r: { id: string }) => r.id)).toEqual([freeFlagged]);
    expect((await admin.agent.get(`/api/admin/rides/${end.id}`).expect(200)).body.ride).toMatchObject({ review: 'rejected', poolId: null });
  });

  it('sign-ins: who, when, from which IP and browser; filter by wallet', async () => {
    const admin = await asAdmin();
    const rider = await login();
    const all = (await admin.agent.get('/api/admin/signins').expect(200)).body.rows;
    expect(all.map((s: { wallet: string }) => s.wallet)).toEqual([rider.address, ADMIN.address]);
    expect(typeof all[0].ip).toBe('string');
    expect((await admin.agent.get(`/api/admin/signins?wallet=${rider.address}`).expect(200)).body.rows).toHaveLength(1);
    await admin.agent.get('/api/admin/signins?wallet=nope').expect(400);
  });

  it('re-judge: the checks run again at the current rules (replacing a decision), audited; needs the header like every change', async () => {
    const admin = await asAdmin();
    const rider = await login();
    const id = await flaggedRide(rider);
    const sig1 = (await signed(admin, id, { action: 'override', decision: 'verified' })).signature;
    await admin.agent.post(`/api/admin/rides/${id}/verdict`).set('x-fc-admin', '1').send({ decision: 'verified', signature: sig1 }).expect(200);
    await admin.agent.post(`/api/admin/rides/${id}/rejudge`).send({ signature: 'x' }).expect(403);
    await admin.agent.post(`/api/admin/rides/${id}/rejudge`).set('x-fc-admin', '1').send({}).expect(400);
    const sig2 = (await signed(admin, id, { action: 'rejudge' })).signature;
    const again = (await admin.agent.post(`/api/admin/rides/${id}/rejudge`).set('x-fc-admin', '1').send({ signature: sig2 }).expect(200)).body;
    expect(again).toMatchObject({ status: 'flagged', override: null });
    expect((await admin.agent.get('/api/admin/actions').expect(200)).body.rows.map((a: { action: string }) => a.action)).toEqual(['verdict.rejudge', 'verdict.override', 'auth.signin']);
  });

  it('the directory: players (list + one rider in full), pools, statistics and sessions – read-only, admin only, bad parameters are 400s and unknown ones 404s', async () => {
    const admin = await asAdmin();
    const rider = await login();
    const rideId = (await rider.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body.id as string;
    await rider.agent.post(`/api/rides/${rideId}/start`).expect(200);
    expect((await admin.agent.get('/api/admin/queue/count').expect(200)).body).toEqual({ flagged: 0, underReview: 0 });
    const list = (await admin.agent.get('/api/admin/players').expect(200)).body.rows as { wallet: string; freeRides: number; lastSignInAt: number | null }[];
    expect(list.map((p) => p.wallet)).toEqual(expect.arrayContaining([rider.address, ADMIN.address]));
    expect(list.find((p) => p.wallet === rider.address)).toMatchObject({ freeRides: 9, rides: 0, tickets: 0 });
    expect(list.find((p) => p.wallet === rider.address)?.lastSignInAt).toEqual(expect.any(Number));
    const prefix = rider.address.slice(0, 8);
    expect((await admin.agent.get(`/api/admin/players?q=${prefix}`).expect(200)).body.rows.map((p: { wallet: string }) => p.wallet)).toEqual([rider.address]);
    const otherPrefix = prefix.replace(/[a-zA-Z]/g, (c) => {
      const flipped = c.toLowerCase() === c ? c.toUpperCase() : c.toLowerCase();
      return '0OIl'.includes(flipped) ? (c.toLowerCase() === 'o' ? 'p' : 'a') : flipped;
    });
    expect((await admin.agent.get(`/api/admin/players?q=${otherPrefix}`).expect(200)).body.rows).toEqual([]);
    expect((await admin.agent.get('/api/admin/players?q=0OIl').expect(400)).body.code).toBeDefined();
    const one = (await admin.agent.get(`/api/admin/players/${rider.address}`).expect(200)).body;
    expect(one.player).toMatchObject({ wallet: rider.address, freeRides: 9 });
    expect(one.rides.map((r: { id: string }) => r.id)).toEqual([rideId]);
    expect(one.signIns).toHaveLength(1);
    expect(one).toMatchObject({ stats: null, tickets: [], payments: { count: 0, lamports: 0 } });
    await admin.agent.get('/api/admin/players/not-a-wallet').expect(400);
    await admin.agent.get(`/api/admin/players/${newWallet().address}`).expect(404);
    expect((await admin.agent.get('/api/admin/pools').expect(200)).body).toEqual({ rows: [] });
    await admin.agent.get('/api/admin/pools/1').expect(404);
    await admin.agent.get('/api/admin/pools/x').expect(400);
    await admin.agent.get('/api/admin/pools/3000000000').expect(400);
    expect((await admin.agent.get('/api/admin/stats').expect(200)).body).toMatchObject({ global: null, daily: [], top: [] });
    await admin.agent.get('/api/admin/stats?days=0').expect(400);
    const sessionsBody = (await admin.agent.get('/api/admin/sessions?days=7').expect(200)).body as { rows: { wallet: string; signIns: number }[]; truncated: boolean };
    const sessions = sessionsBody.rows;
    expect(sessionsBody.truncated).toBe(false);
    expect(sessions.find((s) => s.wallet === rider.address)).toMatchObject({ signIns: 1 });
    await admin.agent.get('/api/admin/sessions?days=99').expect(400);
  });

  it('an override of an unknown ride or of a ride without a verdict is a 404 and is not audited', async () => {
    const admin = await asAdmin();
    const rider = await login();
    const r = (await rider.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    const unknown = '00000000-0000-4000-8000-ffffffffffff';
    const sig3 = (await signed(admin, unknown, { action: 'override', decision: 'rejected' })).signature;
    await admin.agent.post(`/api/admin/rides/${unknown}/verdict`).set('x-fc-admin', '1').send({ decision: 'rejected', signature: sig3 }).expect(404);
    const sig4 = (await signed(admin, r.id, { action: 'override', decision: 'rejected' })).signature;
    await admin.agent.post(`/api/admin/rides/${r.id}/verdict`).set('x-fc-admin', '1').send({ decision: 'rejected', signature: sig4 }).expect(404);
    expect((await admin.agent.get('/api/admin/actions').expect(200)).body.rows.map((a: { action: string }) => a.action)).toEqual(['auth.signin']);
  });

  it('pools: every pool with its winners list; a signed HOLD stops the automatic payout, a signed release lets it go – both audited; a signature for another pool is refused', async () => {
    const now = new Date(h().clock.ms);
    await h().app.get(PoolRepositoryPort, { strict: false }).upsert(aPool({ id: 4, status: 'active', minTickets: 2, ticketsSold: 3 }, now));
    const admin = await asAdmin();
    const listed = (await admin.agent.get('/api/admin/pool-payouts').set('x-fc-admin', '1').expect(200)).body;
    expect(listed.pools.map((p: { pool: { id: number }; hold: unknown; standings: { poolId: number } }) => [p.pool.id, p.standings.poolId, p.hold])).toEqual([[4, 4, null]]);
    const ask = async (poolId: number, hold: boolean, note: string | null) => {
      const { body } = await admin.agent.post(`/api/admin/pools/${poolId}/hold/challenge`).set('x-fc-admin', '1').send({ action: 'pool_hold', hold, note }).expect(200);
      expect(body.message).toContain(`pool ${poolId}`);
      return sign(admin.kp, body.message);
    };
    const forOther = await ask(5, true, null);
    await admin.agent.post('/api/admin/pools/4/hold').set('x-fc-admin', '1').send({ hold: true, note: null, signature: forOther }).expect(401);
    const sig = await ask(4, true, 'rank 1 looks odd');
    expect((await admin.agent.post('/api/admin/pools/4/hold').set('x-fc-admin', '1').send({ hold: true, note: 'rank 1 looks odd', signature: sig }).expect(200)).body)
      .toMatchObject({ poolId: 4, held: true, by: ADMIN.address, note: 'rank 1 looks odd' });
    expect((await anon().get('/api/pools/4').expect(200)).body.payout).toMatchObject({ held: true });
    const off = await ask(4, false, null);
    expect((await admin.agent.post('/api/admin/pools/4/hold').set('x-fc-admin', '1').send({ hold: false, note: null, signature: off }).expect(200)).body).toMatchObject({ held: false });
    const actions = (await admin.agent.get('/api/admin/actions').set('x-fc-admin', '1').expect(200)).body;
    expect(JSON.stringify(actions)).toContain('pool.hold');
    expect(JSON.stringify(actions)).toContain('pool.release');
  });
}
