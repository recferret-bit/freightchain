import { bindClient, newWallet, sign, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { recording, upload } from '../support/recording.js';

/* The admin surface (/api/admin/*): invisible to everyone but ADMIN_WALLETS, the review queue, an audited override, sign-ins, the log ring.
   Same scenarios on in-memory and PostgreSQL. A free shift = 10 s / 140 m. */
export const ADMIN = newWallet();
export const ADMIN_ENV = { FREE_RIDE_SECONDS: '10', ADMIN_WALLETS: ADMIN.address };

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
    for (const path of ['overview', 'rides', 'rides/x', 'signins', 'actions', 'logs']) {
      await anon().get(`/api/admin/${path}`).expect(404);
      await rider.agent.get(`/api/admin/${path}`).expect(404);
    }
    await rider.agent.post('/api/admin/rides/x/verdict').set('x-fc-admin', '1').send({ decision: 'verified', signature: 's' }).expect(404);
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
}
