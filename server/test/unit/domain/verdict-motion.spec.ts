import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { MAX_SPEED } from '../../../src/domain/rides/ride-rules.js';
import { RideBatch, type BatchBody, type BatchFacts, type InputEvent } from '../../../src/domain/telemetry/ride-batch.entity.js';
import { RideVerdict } from '../../../src/domain/verdict/ride-verdict.entity.js';
import { checkMotion, recordedSecondsOf } from '../../../src/domain/verdict/recording-checks.js';
import { summariseBatch, parseSummary } from '../../../src/domain/telemetry/batch-summary.js';
import { roadPlanFor } from '../../../src/domain/road/road-plan.js';
import { MISMATCH_METRES, SAMPLE_GAP_REJECT } from '../../../src/domain/verdict/verdict-rules.js';
import { VerdictStatus } from '../../../src/domain/verdict/verdict.dto.js';
import { hashBatch, recording } from '../../support/recording.js';

/* The recording against itself (pentest 2026-10, fix-plan H1 / H3): samples must really cover the time the batches declare, the position must not run
   ahead of the recorded speed, and the samples' gas bit must match the gas presses. Promoted from pentest/pocs/server/s4-claude.spec.ts (S4-01, S4-01b,
   S4-10) and verdict-forge.spec.ts ("a generator that never ran the game"). */

const T0 = new Date(Date.UTC(2036, 9, 8, 12, 0, 0));
const at = (s: number) => new Date(T0.getTime() + s * 1000);

/** a completed paid shift that drove `seconds` (credited) and ended at `distance` */
function completed(seconds: number, distance: number, credited = seconds): Ride {
  const ride = Ride.createFromTicket({ id: 'ride-1', wallet: 'w', tier: '1h', seed: 7, minSeconds: Math.max(1, Math.floor(distance / (0.5 * MAX_SPEED))), timeScale: 1, poolId: 1, roundId: 1, now: T0 });
  ride.start(T0);
  const done = Ride.restore({ ...ride.snapshot(), lastS: distance, lastT: credited, driveSeconds: credited, lastHbAt: at(seconds) });
  done.finish('shift', null, at(seconds));
  expect(done.status).toBe('completed');
  return done;
}
/** chain `bodies` to the ride and accept them in order (no road plan: these rides cross no planned hole that matters here) */
function chained(bodies: Omit<BatchBody, 'hash' | 'prevHash'>[]): RideBatch[] {
  let prevHash = 'ride-1';
  return bodies.map((b) => {
    const body = { ...b, prevHash };
    const hash = hashBatch(body);
    prevHash = hash;
    return RideBatch.accept('ride-1', { ...body, hash }, hash, at(b.t1));
  });
}
const stored = (bodies: BatchBody[]) => bodies.map((b) => RideBatch.accept('ride-1', b, hashBatch(b), at(b.t1)));
const judge = (ride: Ride, batches: readonly BatchFacts[]) => RideVerdict.judge(ride, batches, at(ride.driveSeconds + 1));
const codes = (v: RideVerdict) => v.reasons.map((r) => r.code);
const row = (t: number, s: number, v: number, gas = 0.6): number[] => [Math.round(t * 100) / 100, Math.round(s * 10) / 10, 2.4, 0, v, 1800, 7, 100, gas, 0, 0, 0];

describe('the recording against itself', () => {
  it('an honest recording (replay columns, human inputs) is VERIFIED; its gaps, speed excess and gas edges are measured', () => {
    const v = judge(completed(120, 1680), stored(recording('ride-1', { seconds: 120, distance: 1680, replay: true })));
    expect(v.status, JSON.stringify(v.reasons)).toBe(VerdictStatus.Verified);
    const r = v.snapshot().scores.recording;
    expect(r.maxGap).toBeLessThanOrEqual(0.11);
    expect(Math.abs(r.speedExcess ?? Infinity)).toBeLessThan(5);
    expect(r.gasEdges).toBeGreaterThan(0);
    expect(r.gasEdges).toBeLessThanOrEqual(r.gasPresses!);
  });

  it('S4-01: empty batches that only declare [t0, t1] (one W press) are REJECTED – no sample, nothing recorded', () => {
    const bodies = Array.from({ length: 4 }, (_, seq) => ({ seq, t0: seq * 15, t1: seq * 15 + 15, samples: [], inputs: seq === 0 ? [[500, 'KeyW', 1] as InputEvent] : [] }));
    const v = judge(completed(60, 840), chained(bodies));
    expect(v.status).toBe(VerdictStatus.Rejected);
    expect(codes(v)).toEqual(expect.arrayContaining(['recording-empty', 'recording-incomplete']));
    expect(v.snapshot().scores.recording.recordedSeconds).toBe(0);
  });

  it('two samples 15 s apart per batch, or 150 rows of one instant, do not record 15 s', () => {
    const sparse = Array.from({ length: 4 }, (_, seq) => ({ seq, t0: seq * 15, t1: seq * 15 + 15, samples: [row(seq * 15, seq * 210, 14), row(seq * 15 + 14.9, seq * 210 + 209, 14)], inputs: [] }));
    const facts = chained(sparse);
    expect(facts.reduce((a, b) => a + recordedSecondsOf(b), 0)).toBeLessThan(1);
    const v = judge(completed(60, 840), facts);
    expect(codes(v)).toEqual(expect.arrayContaining(['sample-gap', 'recording-incomplete']));

    const pile = [{ seq: 0, t0: 0, t1: 15, samples: Array.from({ length: 150 }, () => row(7, 100, 14)), inputs: [] }];
    expect(recordedSecondsOf(chained(pile)[0]!)).toBeCloseTo(0.1);
  });

  it('S4-05: two rows of one game instant that are metres apart are a forged row (sample-out-of-order)', () => {
    const rows = Array.from({ length: 150 }, (_, i) => row(i * 0.1, i * 2.8, MAX_SPEED));
    rows.splice(70, 0, row(rows[69]![0]!, rows[69]![1]! + 1.5, MAX_SPEED));
    const [b] = chained([{ seq: 0, t0: 0, t1: 15, samples: rows, inputs: [] }]);
    expect(b!.summary.fault?.code).toBe('sample-out-of-order');
  });

  it('a generator advancing s at 50 m/s with the speedometer on the 28 m/s governor is REJECTED speed-mismatch – also across batch boundaries', () => {
    const rows = Array.from({ length: 600 }, (_, i) => row(i * 0.1, i * 5, MAX_SPEED));   // 5 m a 0.1 s step: under the teleport cap, 1.8× the governor
    const bodies = [0, 1, 2, 3].map((seq) => ({ seq, t0: seq * 15, t1: seq * 15 + 15, samples: rows.slice(seq * 150, seq * 150 + 150), inputs: seq === 0 ? [[500, 'KeyW', 1] as InputEvent] : [] }));
    const v = judge(completed(60, rows.at(-1)![1]!), chained(bodies));
    expect(v.status).toBe(VerdictStatus.Rejected);
    expect(codes(v)).toContain('speed-mismatch');
    expect(codes(v)).not.toContain('teleport');
    expect(v.snapshot().scores.recording.speedExcess).toBeGreaterThan(1000);
  });

  it('S4-10: a game clock that credited nothing does not make a short recording cover a long ride – the distance needs its time at the governor', () => {
    const rows = Array.from({ length: 300 }, (_, i) => row(i * 0.1, i * 2.8, MAX_SPEED));
    const v = judge(completed(1800, 30_000, 0), chained([{ seq: 0, t0: 0, t1: 15, samples: rows.slice(0, 150), inputs: [[500, 'KeyW', 1]] }, { seq: 1, t0: 15, t1: 30, samples: rows.slice(150), inputs: [] }]));
    expect(codes(v)).toContain('recording-incomplete');
    expect(v.snapshot().scores.recording.coverage).toBeLessThan(0.05);
  });

  it('samples whose gas bit rises far more often than a gas key went down FLAG inputs-mismatch (input events made up for someone else\'s samples)', () => {
    const real = recording('ride-1', { seconds: 120, distance: 1680, replay: true });
    const madeUp = real.map((b) => ({ ...b, inputs: b.seq === 0 ? [[500, 'KeyW', 1] as InputEvent] : [] }));
    const v = judge(completed(120, 1680), chained(madeUp));
    expect(codes(v)).toContain('inputs-mismatch');
  });

  it('batches measured before these checks (no gap / motion / gas edges in the summary) get no opinion on them', () => {
    const facts = stored(recording('ride-1', { seconds: 60, distance: 840, replay: true })).map((b) => {
      const { gap: _g, motion: _m, edgeV: _e, gasEdges: _ge, ...old } = b.summary;
      return { seq: b.seq, prevHash: b.prevHash, hash: b.hash, hashOk: b.hashOk, t0: b.t0, t1: b.t1, summary: old };
    });
    const v = judge(completed(60, 840), facts);
    expect(v.status, JSON.stringify(v.reasons)).toBe(VerdictStatus.Verified);
    expect(v.snapshot().scores.recording.maxGap).toBeUndefined();
    expect(v.snapshot().scores.recording.speedExcess).toBeUndefined();
  });

  it('review M1: an EMPTY batch between two batches does not hide the step across it (sample-gap / speed excess are measured across)', () => {
    const a = Array.from({ length: 150 }, (_, i) => row(i * 0.1, i * 2.8, MAX_SPEED));
    const c = Array.from({ length: 150 }, (_, i) => row(20 + i * 0.1, 2000 + i * 2.8, MAX_SPEED));   // 5 s and 1.6 km later
    const facts = chained([{ seq: 0, t0: 0, t1: 15, samples: a, inputs: [] }, { seq: 1, t0: 15, t1: 15, samples: [], inputs: [] }, { seq: 2, t0: 15, t1: 35, samples: c, inputs: [] }]);
    expect(checkMotion({ rideId: 'r', driveSeconds: 35, distance: 2417 }, facts).reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['sample-gap', 'speed-mismatch']));
  });

  it('review M2 / M3: absurd values are a bad sample, refused before anything is measured – no hours-long road plan, no Infinity in the summary', () => {
    const plan = roadPlanFor(7, '1h');
    const t = Date.now();
    const huge = summariseBatch(0, 0, 15, [row(0, 0, 10), row(0.1, 1e12, 10)], [], plan);
    expect(Date.now() - t).toBeLessThan(500);
    expect(huge.fault?.code).toBe('bad-sample');
    expect(huge.world).toBeNull();
    const negative = summariseBatch(0, 0, 15, [row(0, 0, -1e307), row(0.1, 1, 10)], []);
    expect(negative.fault?.code).toBe('bad-sample');
    expect(JSON.stringify(negative)).not.toMatch(/null,null|Infinity/);
    const fine = summariseBatch(0, 0, 15, Array.from({ length: 150 }, (_, i) => row(i * 0.1, i * 2, 20)), []);
    expect(parseSummary(JSON.parse(JSON.stringify(fine)))).toEqual(fine);   // what is stored reads back whole – motion, edgeV, gap included
  });

  it('review M4: a speedometer read above the governor buys no distance – the game clamps v at exactly 28 m/s', () => {
    const rows = Array.from({ length: 600 }, (_, i) => row(i * 0.1, i * 2.94, 29.4));   // 1.05× the governor, the speedometer agreeing
    const bodies = [0, 1, 2, 3].map((seq) => ({ seq, t0: seq * 15, t1: seq * 15 + 15, samples: rows.slice(seq * 150, seq * 150 + 150), inputs: [] }));
    expect(checkMotion({ rideId: 'r', driveSeconds: 60, distance: 1764 }, chained(bodies)).reasons.map((r) => r.code)).toEqual(['speed-mismatch']);   // 88 m over 1.76 km: past 50 m + 1 %
    const long = Array.from({ length: 36000 }, (_, i) => row(i * 0.1, i * 2.94, 29.4));
    const many = Array.from({ length: 240 }, (_, seq) => ({ seq, t0: seq * 15, t1: seq * 15 + 15, samples: long.slice(seq * 150, seq * 150 + 150), inputs: [] }));
    expect(checkMotion({ rideId: 'r', driveSeconds: 3600, distance: 105_840 }, chained(many)).reasons.map((r) => r.code)).toEqual(['speed-mismatch']);
  });

  it('review B2 / B3: rows repeating one instant record no time; a game clock that steps back at all is a fault', () => {
    const repeated = Array.from({ length: 150 }, (_, i) => row(Math.floor(i / 10), Math.floor(i / 10) * 28, MAX_SPEED));   // one real row a second, ten times each
    expect(recordedSecondsOf(chained([{ seq: 0, t0: 0, t1: 15, samples: repeated, inputs: [] }])[0]!)).toBeCloseTo(1.5);
    const back = [row(0, 0, 20), row(0.2, 4, 20), row(0.16, 4, 20), row(0.36, 8, 20)];
    expect(summariseBatch(0, 0, 15, back, []).fault?.code).toBe('sample-out-of-order');
  });

  it('a batch with a fault (it rejects on its own) is no gap: the steps beside it are not measured, whether its rows stopped early or were refused whole', () => {
    const rows = (t0: number) => Array.from({ length: 150 }, (_, i) => row(t0 + i * 0.1, (t0 + i * 0.1) * 20, 20));
    for (const bad of [[...rows(15).slice(0, 3), [16, 300, 2.4, 0, 20]], rows(15).map((r, i) => (i === 3 ? [r[0]! + 60, ...r.slice(1)] : r))]) {
      const facts = chained([{ seq: 0, t0: 0, t1: 15, samples: rows(0), inputs: [] }, { seq: 1, t0: 15, t1: 30, samples: rows(15), inputs: [] }, { seq: 2, t0: 30, t1: 45, samples: rows(30), inputs: [] }]);
      const saved = facts[1]!.snapshot();
      facts[1] = RideBatch.restore({ ...saved, body: { ...saved.body, samples: bad }, summary: null }); // old recordings bypass today's upload gate
      expect(facts[1]!.summary.fault).not.toBeNull();
      expect(checkMotion({ rideId: 'r', driveSeconds: 45, distance: 900 }, facts).reasons).toEqual([]);
    }
  });

  it('checkMotion: thresholds at their edges', () => {
    const gapRows = [row(0, 0, 10), row(0.1, 1, 10), row(0.1 + SAMPLE_GAP_REJECT + 0.05, 1 + 10 * (SAMPLE_GAP_REJECT + 0.05), 10)];
    expect(checkMotion({ rideId: 'r', driveSeconds: 2, distance: 20 }, chained([{ seq: 0, t0: 0, t1: 2, samples: gapRows, inputs: [] }])).reasons.map((r) => r.code)).toEqual(['sample-gap']);
    const ahead = (m: number) => [row(0, 0, 10), row(0.1, 1 + m, 10)];
    expect(checkMotion({ rideId: 'r', driveSeconds: 1, distance: 0 }, chained([{ seq: 0, t0: 0, t1: 1, samples: ahead(MISMATCH_METRES - 1), inputs: [] }])).reasons).toEqual([]);
    expect(checkMotion({ rideId: 'r', driveSeconds: 1, distance: 0 }, chained([{ seq: 0, t0: 0, t1: 1, samples: ahead(MISMATCH_METRES + 1), inputs: [] }])).reasons.map((r) => r.code)).toEqual(['speed-mismatch']);
  });
});
