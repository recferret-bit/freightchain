import { bindClient, newWallet, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { answersFor, recording, upload, type RecordingOptions } from '../support/recording.js';
import type { ChallengeDto } from '../../src/domain/rides/ride-challenge.js';
import { RECORDING_BYTES_SLACK } from '../../src/domain/telemetry/telemetry-rules.js';

/* Verified play end to end: the game uploads its recording, /end judges it, only verified paid shifts rank. Nothing is simulated on the server –
   the verdict validates the recording and measures how human the input timing looks. Same scenarios on in-memory and PostgreSQL. */
export const VERDICT_DEMO = newWallet();
export const VERDICT_ENV = { FREE_RIDE_SECONDS: '10', DEMO_WALLETS: VERDICT_DEMO.address, CHALLENGE_INTERVAL_SECONDS: '8' }; // a prompt about every other heartbeat of the 60 s demo shift

export function verdictScenarios(h: () => Harness): void {
  const { anon, login, sec } = bindClient(h);
  beforeEach(() => h().reset());

  /** a demo paid 1 h shift (60 s, 840 m): pay, start, beat (collecting the dispatch prompts the heartbeats carry), upload the recording – with the prompts
      answered `reactionMs` after they were issued (null = ignored) –, end */
  async function paidShift(rider: Rider, rec: Partial<RecordingOptions> | null, metres = 910, reactionMs: number | null = 600) {
    const { id, prompts } = await driven(rider, metres);
    if (rec) await upload(rider.agent, id, recording(id, { seconds: 70, distance: metres, answers: reactionMs === null ? [] : answersFor(prompts, reactionMs), ...rec }));
    return (await rider.agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: metres, t: 70, hull: 100 }).expect(200)).body;
  }
  async function driven(rider: Rider, metres = 910) {
    const r = (await rider.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    const signature = h().chain.addPayment({ payer: rider.address, lamports: r.lamports, memo: r.id });
    await rider.agent.post(`/api/rides/${r.id}/confirm`).send({ signature }).expect(200);
    await rider.agent.post(`/api/rides/${r.id}/start`).expect(200);
    const prompts: ChallengeDto[] = [];
    for (let i = 1; i <= 7; i++) {
      sec(10);
      const hb = (await rider.agent.post(`/api/rides/${r.id}/heartbeat`).send({ s: (i * metres) / 7, t: i * 10, hull: 100 }).expect(200)).body;
      if (hb.challenge && !prompts.some((p) => p.id === hb.challenge.id)) prompts.push(hb.challenge);
    }
    return { id: r.id as string, prompts };
  }

  it('a human-timed recording → /end answers VERIFIED and the shift ranks on the paid boards', async () => {
    const d = await login(VERDICT_DEMO);
    const end = await paidShift(d, {});
    expect(end).toMatchObject({ status: 'completed', verdict: { status: 'verified', reasons: [] } });
    expect((await d.agent.get(`/api/rides/${end.id}`).expect(200)).body.verdict.status).toBe('verified');
    for (const board of ['round', 'all']) expect((await anon().get(`/api/leaderboard?board=${board}`).expect(200)).body.rows[0]).toMatchObject({ wallet: d.address, distance: 910 });
    expect((await d.agent.get('/api/profile').expect(200)).body.recent[0]).toMatchObject({ status: 'completed', verdict: 'verified' });
  });

  it('a complete shift whose tab CLOSES: the /end beacon (text/plain) completes it; the last batch that never left only costs coverage', async () => {
    const closeAfter = async (d: Rider, recorded: number) => {   // driven 70 s / 910 m; the batches up to `recorded` s arrived, the rest died with the tab
      const { id, prompts } = await driven(d);
      await upload(d.agent, id, recording(id, { seconds: recorded, distance: (910 * recorded) / 70, answers: answersFor(prompts) }));
      return (await d.agent.post(`/api/rides/${id}/end`).set('content-type', 'text/plain;charset=UTF-8')
        .send(JSON.stringify({ outcome: 'shift', s: 910, t: 70, hull: 100, reason: 'the driver closed the game' })).expect(200)).body;
    };
    const d = await login(VERDICT_DEMO);
    expect(await closeAfter(d, 64)).toMatchObject({ status: 'completed', verdict: { status: 'verified', reasons: [] } });   // 6 s lost of 70 (91 %): still verified
    const short = await closeAfter(d, 55);   // a whole 15 s batch lost of a SHORT shift (79 %) – flagged for review, never rejected; at 30 min one batch is < 1 %
    expect(short).toMatchObject({ status: 'completed', verdict: { status: 'flagged' } });
    expect(short.verdict.reasons.map((x: { code: string }) => x.code)).toEqual(['recording-gaps']);
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

  it('a recording with the replay columns (clock, switches, inputs) is judged exactly like one without – VERIFIED, ranked', async () => {
    const d = await login(VERDICT_DEMO);
    const end = await paidShift(d, { replay: true });
    expect(end).toMatchObject({ status: 'completed', verdict: { status: 'verified', reasons: [] } });
  });

  it('a recording that contradicts the ride (ends 600 m short) → REJECTED', async () => {
    const d = await login(VERDICT_DEMO);
    const { id, prompts } = await driven(d);
    await upload(d.agent, id, recording(id, { seconds: 70, distance: 310, answers: answersFor(prompts) }));
    const end = (await d.agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 910, t: 70 }).expect(200)).body;
    expect(end.verdict.reasons.map((x: { code: string }) => x.code)).toContain('recording-mismatch');
    expect(end.verdict.status).toBe('rejected');
  });

  it('the final batch landing after /end re-judges the ride: the last 15 s are no longer missing', async () => {
    const d = await login(VERDICT_DEMO);
    const { id, prompts } = await driven(d);
    const batches = recording(id, { seconds: 70, distance: 910, answers: answersFor(prompts) });
    await upload(d.agent, id, batches.slice(0, -1));
    const end = (await d.agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 910, t: 70 }).expect(200)).body;
    expect(end.verdict.status).not.toBe('verified'); // the tail is missing: it ends short of 910 m
    sec(5);
    await upload(d.agent, id, batches.slice(-1));
    expect((await d.agent.get(`/api/rides/${id}`).expect(200)).body.verdict).toMatchObject({ status: 'verified', reasons: [] });
  });

  describe('dispatch prompts (challenge prompts)', () => {
    it('the heartbeat response carries the open prompt – what to do, which keys answer it, its window; GET /api/rides/:id never does', async () => {
      const d = await login(VERDICT_DEMO);
      const { id, prompts } = await driven(d);
      expect(prompts.length).toBeGreaterThanOrEqual(3);
      expect(prompts[0]).toMatchObject({ id: expect.any(String), action: expect.stringMatching(/^(headlights|wipers|cab|washer)$/), label: expect.any(String), key: expect.stringMatching(/^[LRCX]$/), codes: expect.any(Array) });
      expect(prompts[0]!.deadlineMs - prompts[0]!.issuedMs).toBe(20_000);
      expect(new Set(prompts.map((p) => p.id)).size).toBe(prompts.length); // each one once
      expect((await d.agent.get(`/api/rides/${id}`).expect(200)).body.challenge).toBeNull();
    });

    it('answered like a person → VERIFIED, with the answers in the scores', async () => {
      const d = await login(VERDICT_DEMO);
      const end = await paidShift(d, {}, 910, 600);
      expect(end.verdict).toMatchObject({ status: 'verified', reasons: [] });
      const admin = (await d.agent.get(`/api/rides/${end.id}`).expect(200)).body;
      expect(admin.verdict.status).toBe('verified');
    });

    it('IGNORED → REJECTED (challenges-ignored): nobody was at the wheel – not on the boards', async () => {
      const d = await login(VERDICT_DEMO);
      const end = await paidShift(d, {}, 910, null);
      expect(end.verdict.status).toBe('rejected');
      expect(end.verdict.reasons.map((r: { code: string }) => r.code)).toContain('challenges-ignored');
      expect((await anon().get('/api/leaderboard').expect(200)).body.rows).toEqual([]);
    });

    it('answered the instant they were issued (a script reading the heartbeat) → FLAGGED challenge-reflex, for a person to review', async () => {
      const d = await login(VERDICT_DEMO);
      const end = await paidShift(d, {}, 910, 15);
      expect(end.verdict.status).toBe('flagged');
      expect(end.verdict.reasons.map((r: { code: string }) => r.code)).toEqual(['challenge-reflex']);
    });
  });

  describe('the hash chain', () => {
    it('a batch the client could not hash (hash null, the next chained to unhashed-<seq>) only FLAGS – the server hashed it itself', async () => {
      const d = await login(VERDICT_DEMO);
      const { id, prompts } = await driven(d);
      const batches = recording(id, { seconds: 70, distance: 910, answers: answersFor(prompts) });
      const b2 = batches[2]!;
      batches[2] = { ...b2, hash: null };
      batches[3] = { ...batches[3]!, prevHash: 'unhashed-2' };
      batches[3].hash = (await import('../support/recording.js')).hashBatch(batches[3]);
      for (let i = 4; i < batches.length; i++) { batches[i] = { ...batches[i]!, prevHash: batches[i - 1]!.hash as string }; batches[i]!.hash = (await import('../support/recording.js')).hashBatch(batches[i]!); }
      await upload(d.agent, id, batches);
      const end = (await d.agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 910, t: 70 }).expect(200)).body;
      expect(end.verdict.status).toBe('flagged');
      expect(end.verdict.reasons).toEqual([{ code: 'unhashed-batch', detail: expect.stringContaining('batch 2'), severity: 'flag' }]);
    });

    it('a batch whose hash does not match its content (edited after hashing) → REJECTED hash-mismatch', async () => {
      const d = await login(VERDICT_DEMO);
      const { id, prompts } = await driven(d);
      const batches = recording(id, { seconds: 70, distance: 910, answers: answersFor(prompts) });
      batches[1] = { ...batches[1]!, samples: batches[1]!.samples.map((row, i) => (i === 10 ? [...row.slice(0, 4), 27.9, ...row.slice(5)] : row)) }; // one speed value edited, hash kept
      await upload(d.agent, id, batches);
      const end = (await d.agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 910, t: 70 }).expect(200)).body;
      expect(end.verdict.status).toBe('rejected');
      expect(end.verdict.reasons.map((r: { code: string }) => r.code)).toContain('hash-mismatch');
    });

    it('a ride cannot hold more recording bytes than the time since its start allows (400, and the chain stops there)', async () => {
      const d = await login(VERDICT_DEMO);
      const r = (await d.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
      await d.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: h().chain.addPayment({ payer: d.address, lamports: r.lamports, memo: r.id }) }).expect(200);
      await d.agent.post(`/api/rides/${r.id}/start`).expect(200);
      sec(2);
      // 2 s in: the budget is 2 × 4 kB + the slack; a batch of 2000 input events is ≈ 40 kB, so the slack runs out after a few of them
      const fat = (seq: number, prevHash: string) => ({ seq, prevHash, t0: 0, t1: 1, samples: [], inputs: Array.from({ length: 2000 }, (_, i) => [i, 'KeyW', (i % 2) as 0 | 1]) as [number, string, 0 | 1][], hash: null });
      let prev = r.id, bytes = 0, refused: unknown = null;
      for (let seq = 0; seq < 20 && !refused; seq++) {
        const body = fat(seq, prev);
        const res = await d.agent.post(`/api/rides/${r.id}/batches`).send(body);
        if (res.status === 400) refused = res.body; else { expect(res.status).toBe(200); bytes += JSON.stringify(body).length; prev = `unhashed-${seq}`; }
      }
      expect(refused).toMatchObject({ status: 400, code: 'bad_batch', detail: expect.stringContaining('larger than the time since the start allows') });
      expect(bytes).toBeLessThanOrEqual(RECORDING_BYTES_SLACK + 2 * 4096 + 50_000);
    });
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
