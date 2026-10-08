import { bindClient, newWallet, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { recording, upload, type RecordingOptions } from '../support/recording.js';

/* Verified play end to end: the game uploads its recording, /end judges it, only verified paid shifts rank. Nothing is simulated on the server –
   the verdict validates the recording and measures how human the input timing looks. Same scenarios on in-memory and PostgreSQL. */
export const VERDICT_DEMO = newWallet();
export const VERDICT_ENV = { FREE_RIDE_SECONDS: '10', DEMO_WALLETS: VERDICT_DEMO.address };

export function verdictScenarios(h: () => Harness): void {
  const { anon, login, sec } = bindClient(h);
  beforeEach(() => h().reset());

  /** a demo paid 1 h shift (60 s, 840 m): pay, start, beat, upload the recording, end */
  async function paidShift(rider: Rider, rec: Partial<RecordingOptions> | null, metres = 910) {
    const r = (await rider.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    const signature = h().chain.addPayment({ payer: rider.address, lamports: r.lamports, memo: r.id });
    await rider.agent.post(`/api/rides/${r.id}/confirm`).send({ signature }).expect(200);
    await rider.agent.post(`/api/rides/${r.id}/start`).expect(200);
    for (let i = 1; i <= 7; i++) { sec(10); await rider.agent.post(`/api/rides/${r.id}/heartbeat`).send({ s: (i * metres) / 7, t: i * 10, hull: 100 }).expect(200); }
    if (rec) await upload(rider.agent, r.id, recording(r.id, { seconds: 70, distance: metres, ...rec }));
    return (await rider.agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'shift', s: metres, t: 70, hull: 100 }).expect(200)).body;
  }

  it('a human-timed recording → /end answers VERIFIED and the shift ranks on the paid boards', async () => {
    const d = await login(VERDICT_DEMO);
    const end = await paidShift(d, {});
    expect(end).toMatchObject({ status: 'completed', verdict: { status: 'verified', reasons: [] } });
    expect((await d.agent.get(`/api/rides/${end.id}`).expect(200)).body.verdict.status).toBe('verified');
    for (const board of ['round', 'all']) expect((await anon().get(`/api/leaderboard?board=${board}`).expect(200)).body.rows[0]).toMatchObject({ wallet: d.address, distance: 910 });
    expect((await d.agent.get('/api/profile').expect(200)).body.recent[0]).toMatchObject({ status: 'completed', verdict: 'verified' });
  });

  it('no recording → REJECTED, still COMPLETED, but not on the paid boards', async () => {
    const d = await login(VERDICT_DEMO);
    const end = await paidShift(d, null);
    expect(end).toMatchObject({ status: 'completed', verdict: { status: 'rejected', reasons: [{ code: 'no-recording', severity: 'reject' }] } });
    expect((await anon().get('/api/leaderboard').expect(200)).body.rows).toEqual([]);
    expect((await anon().get('/api/leaderboard?board=all').expect(200)).body.rows).toEqual([]);
  });

  it('scripted timing → FLAGGED (not rejected), held off the boards until reviewed', async () => {
    const d = await login(VERDICT_DEMO);
    const end = await paidShift(d, { inputs: 'bot' });
    expect(end.verdict.status).toBe('flagged');
    expect(end.verdict.reasons.map((r: { code: string }) => r.code)).toContain('uniform-holds');
    expect((await anon().get('/api/leaderboard').expect(200)).body.rows).toEqual([]);
  });

  it('a recording that contradicts the ride (ends 600 m short) → REJECTED', async () => {
    const d = await login(VERDICT_DEMO);
    const r = (await d.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    await d.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: h().chain.addPayment({ payer: d.address, lamports: r.lamports, memo: r.id }) }).expect(200);
    await d.agent.post(`/api/rides/${r.id}/start`).expect(200);
    for (let i = 1; i <= 7; i++) { sec(10); await d.agent.post(`/api/rides/${r.id}/heartbeat`).send({ s: i * 130, t: i * 10 }).expect(200); }
    await upload(d.agent, r.id, recording(r.id, { seconds: 70, distance: 310 }));
    const end = (await d.agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'shift', s: 910, t: 70 }).expect(200)).body;
    expect(end.verdict.reasons.map((x: { code: string }) => x.code)).toContain('recording-mismatch');
    expect(end.verdict.status).toBe('rejected');
  });

  it('the final batch landing after /end re-judges the ride: the last 15 s are no longer missing', async () => {
    const d = await login(VERDICT_DEMO);
    const r = (await d.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    await d.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: h().chain.addPayment({ payer: d.address, lamports: r.lamports, memo: r.id }) }).expect(200);
    await d.agent.post(`/api/rides/${r.id}/start`).expect(200);
    for (let i = 1; i <= 7; i++) { sec(10); await d.agent.post(`/api/rides/${r.id}/heartbeat`).send({ s: i * 130, t: i * 10 }).expect(200); }
    const batches = recording(r.id, { seconds: 70, distance: 910 });
    await upload(d.agent, r.id, batches.slice(0, -1));
    const end = (await d.agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'shift', s: 910, t: 70 }).expect(200)).body;
    expect(end.verdict.status).not.toBe('verified'); // the tail is missing: it ends short of 910 m
    sec(5);
    await upload(d.agent, r.id, batches.slice(-1));
    expect((await d.agent.get(`/api/rides/${r.id}`).expect(200)).body.verdict).toMatchObject({ status: 'verified', reasons: [] });
  });

  it('only completed shifts are judged; free rides stay on the free board whatever their verdict', async () => {
    const w = await login();
    const crash = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await w.agent.post(`/api/rides/${crash.id}/start`).expect(200);
    sec(3);
    expect((await w.agent.post(`/api/rides/${crash.id}/end`).send({ outcome: 'failed', s: 20, t: 3, reason: 'crash' }).expect(200)).body.verdict).toBeNull();
    const free = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await w.agent.post(`/api/rides/${free.id}/start`).expect(200);
    sec(10);
    expect((await w.agent.post(`/api/rides/${free.id}/end`).send({ outcome: 'shift', s: 150, t: 10 }).expect(200)).body.verdict.status).toBe('rejected');
    expect((await anon().get('/api/leaderboard?board=free').expect(200)).body.rows[0]).toMatchObject({ wallet: w.address, distance: 150 });
  });
}
