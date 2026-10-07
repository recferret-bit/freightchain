import { bindClient, newWallet, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { recording, upload } from '../support/recording.js';

/* The admin surface (/api/admin/*): invisible to everyone but ADMIN_WALLETS, the review queue, an audited override, sign-ins, the log ring.
   Same scenarios on in-memory and PostgreSQL. A free shift = 10 s / 140 m. */
export const ADMIN = newWallet();
export const ADMIN_ENV = { FREE_RIDE_SECONDS: '10', ADMIN_WALLETS: ADMIN.address };

export function adminScenarios(h: () => Harness): void {
  const { anon, login, sec } = bindClient(h);
  beforeEach(() => h().reset());

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
    await rider.agent.post('/api/admin/rides/x/verdict').set('x-fc-admin', '1').send({ decision: 'verified' }).expect(404);
  });

  it('overview: counts, sign-ins of the last day, the verified-play switches', async () => {
    const admin = await login(ADMIN);
    const rider = await login();
    await flaggedRide(rider);
    const o = (await admin.agent.get('/api/admin/overview').expect(200)).body;
    expect(o).toMatchObject({ players: 2, signIns24h: 2, rides: { completed: 1 }, verdicts: { flagged: 1 }, config: { verdictEnforce: true, telemetryRetentionDays: 90 } });
    expect(o.telemetry.batches).toBe(2);
  });

  it('the review queue → one ride in full → an override (needs X-FC-Admin), audited and findable in the log by its request id', async () => {
    const admin = await login(ADMIN);
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
    const ok = await admin.agent.post(`/api/admin/rides/${id}/verdict`).set('x-fc-admin', '1').send({ decision: 'verified', note: 'the tab was hidden for 3 s' }).expect(200);
    expect(ok.body).toMatchObject({ status: 'verified', override: { by: ADMIN.address, note: 'the tab was hidden for 3 s' } });
    const requestId = ok.headers['x-request-id'];

    expect((await rider.agent.get(`/api/rides/${id}`).expect(200)).body.verdict).toMatchObject({ status: 'verified', override: { by: ADMIN.address } });
    expect((await admin.agent.get('/api/admin/rides?verdict=flagged').expect(200)).body.rows).toEqual([]);
    const audit = (await admin.agent.get('/api/admin/actions').expect(200)).body.rows;
    expect(audit[0]).toMatchObject({ wallet: ADMIN.address, action: 'verdict.override', target: id, detail: { from: 'flagged', to: 'verified', rider: rider.address }, requestId });
    const log = (await admin.agent.get(`/api/admin/logs?q=${requestId}`).expect(200)).body.entries;
    expect(log.map((e: { event?: string }) => e.event)).toEqual(expect.arrayContaining(['request', 'admin']));

    sec(1); // the rider's late final batch re-judges the ride – the admin's decision stays
    await rider.agent.post(`/api/rides/${id}/batches`).send(recording(id, { seconds: 10, distance: 140, batchSeconds: 5 })[1]).expect(200);
    expect((await admin.agent.get(`/api/admin/rides/${id}`).expect(200)).body.verdict).toMatchObject({ status: 'verified', override: { by: ADMIN.address } });
  });

  it('sign-ins: who, when, from which IP and browser; filter by wallet', async () => {
    const admin = await login(ADMIN);
    const rider = await login();
    const all = (await admin.agent.get('/api/admin/signins').expect(200)).body.rows;
    expect(all.map((s: { wallet: string }) => s.wallet)).toEqual([rider.address, ADMIN.address]);
    expect(typeof all[0].ip).toBe('string');
    expect((await admin.agent.get(`/api/admin/signins?wallet=${rider.address}`).expect(200)).body.rows).toHaveLength(1);
    await admin.agent.get('/api/admin/signins?wallet=nope').expect(400);
  });

  it('re-judge: the checks run again at the current rules (replacing a decision), audited; needs the header like every change', async () => {
    const admin = await login(ADMIN);
    const rider = await login();
    const id = await flaggedRide(rider);
    await admin.agent.post(`/api/admin/rides/${id}/verdict`).set('x-fc-admin', '1').send({ decision: 'verified' }).expect(200);
    await admin.agent.post(`/api/admin/rides/${id}/rejudge`).expect(403);
    const again = (await admin.agent.post(`/api/admin/rides/${id}/rejudge`).set('x-fc-admin', '1').expect(200)).body;
    expect(again).toMatchObject({ status: 'flagged', override: null });
    expect((await admin.agent.get('/api/admin/actions').expect(200)).body.rows.map((a: { action: string }) => a.action)).toEqual(['verdict.rejudge', 'verdict.override']);
  });

  it('an override of an unknown ride or of a ride without a verdict is a 404 and is not audited', async () => {
    const admin = await login(ADMIN);
    const rider = await login();
    const r = (await rider.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await admin.agent.post('/api/admin/rides/00000000-0000-4000-8000-ffffffffffff/verdict').set('x-fc-admin', '1').send({ decision: 'rejected' }).expect(404);
    await admin.agent.post(`/api/admin/rides/${r.id}/verdict`).set('x-fc-admin', '1').send({ decision: 'rejected' }).expect(404);
    expect((await admin.agent.get('/api/admin/actions').expect(200)).body.rows).toEqual([]);
  });
}
