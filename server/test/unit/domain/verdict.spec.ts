import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { RideBatch, type BatchBody, type InputEvent } from '../../../src/domain/telemetry/ride-batch.entity.js';
import { checkHumanTiming, holdsByCode, timerStepMs } from '../../../src/domain/verdict/human-checks.js';
import { RideVerdict } from '../../../src/domain/verdict/ride-verdict.entity.js';
import { HOLD_CV_MIN, REPEAT_SHARE_MAX, RULES_VERSION } from '../../../src/domain/verdict/verdict-rules.js';
import { VerdictStatus } from '../../../src/domain/verdict/verdict.dto.js';
import { hashBatch, recording, type RecordingOptions } from '../../support/recording.js';

/* The verdict validates the recording and measures the input timing; it never simulates the truck. */
const T0 = new Date(Date.UTC(2036, 9, 8, 12, 0, 0));
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const RULES = { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 };

/** a completed free ride that drove `seconds` and ended at `distance` (reported in one /end, like a short ride) */
function completedRide(seconds: number, distance: number): Ride {
  const ride = Ride.createFree({ id: 'ride-1', wallet: 'w', seed: 7, minSeconds: Math.min(seconds, 10, distance / 14), now: T0 }); // short enough that the drive completes it
  ride.start(T0);
  const p = Ride.restore({ ...ride.snapshot(), lastS: distance, lastT: seconds, driveSeconds: seconds, lastHbAt: at(seconds) });
  p.finish('shift', null, at(seconds));
  expect(p.status).toBe('completed');
  return p;
}
const stored = (bodies: BatchBody[]) => bodies.map((b) => RideBatch.accept('ride-1', b, hashBatch(b), at(b.t1)));
const judge = (seconds: number, distance: number, opts: Partial<RecordingOptions> = {}, edit: (b: BatchBody[]) => BatchBody[] = (b) => b) =>
  RideVerdict.judge(completedRide(seconds, distance), stored(edit(recording('ride-1', { seconds, distance, ...opts }))), at(seconds + 1));
const codes = (v: RideVerdict) => v.reasons.map((r) => r.code);

describe('RideVerdict.judge', () => {
  it('a complete, chained, human-timed recording that ends where the ride ended is VERIFIED', () => {
    const v = judge(120, 1600);
    expect(codes(v)).toEqual([]);
    expect(v.status).toBe(VerdictStatus.Verified);
    expect(v.snapshot()).toMatchObject({ rideId: 'ride-1', rulesVersion: RULES_VERSION, judgedAt: at(121) });
    expect(v.snapshot().scores.recording).toMatchObject({ batches: 8, samples: 1200, recordedSeconds: 120, coverage: 1 });
    expect(v.snapshot().scores.human.presses).toBeGreaterThan(20);
    expect(v.toDto()).toEqual({ status: 'verified', reasons: [], judgedAt: at(121).getTime(), override: null });
  });

  it('no recording at all is REJECTED', () => {
    const v = RideVerdict.judge(completedRide(60, 800), [], at(61));
    expect(v.status).toBe(VerdictStatus.Rejected);
    expect(codes(v)).toEqual(['no-recording']);
  });

  describe('the chain (rejects)', () => {
    it('a missing batch', () => expect(codes(judge(60, 800, {}, (b) => b.filter((x) => x.seq !== 1)))).toContain('missing-batches'));
    it('a batch chained to the wrong predecessor', () => {
      const v = judge(60, 800, {}, (b) => b.map((x) => (x.seq === 2 ? { ...x, prevHash: 'f'.repeat(64), hash: hashBatch({ ...x, prevHash: 'f'.repeat(64) }) } : x)));
      expect(codes(v)).toContain('chain-broken');
      expect(v.status).toBe(VerdictStatus.Rejected);
    });
    it('a batch whose content was changed after hashing (the server recomputes every hash)', () => {
      const v = RideVerdict.judge(completedRide(60, 800), recording('ride-1', { seconds: 60, distance: 800 }).map((b) => RideBatch.accept('ride-1', b, b.seq === 1 ? 'x' : (b.hash ?? ''), T0)), T0);
      expect(codes(v)).toContain('hash-mismatch');
    });
    it("a recording chained to another ride's id", () => {
      const other = recording('ride-2', { seconds: 30, distance: 400 });
      expect(codes(RideVerdict.judge(completedRide(30, 400), stored(other), T0))).toContain('chain-broken');
    });
  });

  describe('validation of the recorded values (rejects)', () => {
    const patch = (seq: number, i: number, col: number, value: number) => (b: BatchBody[]) => b.map((x) => {
      if (x.seq !== seq) return x;
      const samples = x.samples.map((row, j) => (j === i ? row.map((c, k) => (k === col ? value : c)) : row));
      const body = { ...x, samples };
      return { ...body, hash: hashBatch(body) };
    });
    it('a speed above the governor', () => expect(codes(judge(60, 800, {}, patch(1, 10, 4, 31)))).toContain('over-governor'));
    it('a jump in distance the truck cannot make between two samples', () => expect(codes(judge(60, 800, {}, patch(1, 10, 1, 9000)))).toContain('teleport'));
    it('samples out of time order', () => expect(codes(judge(60, 800, {}, patch(1, 10, 0, 3)))).toContain('sample-out-of-order'));
    it('a short sample row', () => {
      const v = judge(60, 800, {}, (b) => b.map((x) => (x.seq === 0 ? { ...x, samples: [[0, 0]], hash: hashBatch({ ...x, samples: [[0, 0]] }) } : x)));
      expect(codes(v)).toContain('bad-sample');
    });
    it('a recording that ends somewhere else than the ride', () => {
      const v = RideVerdict.judge(completedRide(60, 1600), stored(recording('ride-1', { seconds: 60, distance: 800 })), T0);
      expect(codes(v)).toContain('recording-mismatch');
    });
    it('a lost LAST batch (the final flush never arrived) only costs coverage – the recording ending early is not a mismatch', () => {
      const v = judge(120, 1600, {}, (b) => b.slice(0, -1)); // 105 of 120 s: the last sample is ~200 m short of the ride's end
      expect(codes(v)).toEqual(['recording-gaps']);
      expect(v.status).toBe(VerdictStatus.Flagged);
    });

    it('a recording covering under half of the driven time; 50–90 % only flags', () => {
      const half = RideVerdict.judge(completedRide(120, 600), stored(recording('ride-1', { seconds: 45, distance: 600 })), T0);
      expect(codes(half)).toContain('recording-incomplete');
      expect(half.status).toBe(VerdictStatus.Rejected);
      const most = RideVerdict.judge(completedRide(120, 1500), stored(recording('ride-1', { seconds: 90, distance: 1500 })), T0);
      expect(codes(most)).toEqual(['recording-gaps']);
      expect(most.status).toBe(VerdictStatus.Flagged);
    });
    it('a truck that moved without one input event, or without ever pressing the gas', () => {
      expect(codes(judge(60, 800, { inputs: 'none' }))).toContain('no-inputs');
      const noGas = judge(60, 800, {}, (b) => b.map((x) => { const body = { ...x, inputs: x.inputs.filter((e) => e[1] !== 'KeyW') }; return { ...body, hash: hashBatch(body) }; }));
      expect(codes(noGas)).toContain('no-throttle-input');
    });
    it('a ride that barely moved needs no inputs (a stall at the depot is not cheating)', () => {
      expect(codes(judge(20, 30, { inputs: 'none' }))).toEqual([]);
    });
  });

  describe('human-likeness (flags only, never rejects)', () => {
    it('metronome timing from a script is FLAGGED, not rejected', () => {
      const v = judge(180, 2400, { inputs: 'bot' });
      expect(v.status).toBe(VerdictStatus.Flagged);
      expect(codes(v)).toEqual(expect.arrayContaining(['uniform-holds', 'repeated-timings']));
      expect(v.reasons.every((r) => r.severity === 'flag')).toBe(true);
    });

    it('down and up in the same tick on most presses', () => {
      const events: InputEvent[] = Array.from({ length: 20 }, (_, i) => [[i * 731.3 + (i % 3) * 17, 'KeyA', 1], [i * 731.3 + (i % 3) * 17 + 2, 'KeyA', 0]] as InputEvent[]).flat();
      expect(checkHumanTiming(events).reasons.map((r) => r.code)).toContain('instant-presses');
    });

    it('a coarse browser clock (Firefox resistFingerprinting / Tor) is detected and does not make a person look scripted', () => {
      const rnd = (i: number) => ((i * 7919) % 97) / 97; // deterministic spread
      const human: InputEvent[] = Array.from({ length: 30 }, (_, i) => {
        const down = Math.round((i * 1300 + rnd(i) * 900) / 100) * 100, hold = Math.round((40 + rnd(i + 3) * 300) / 100) * 100; // everything on a 100 ms grid
        return [[down, i % 2 ? 'KeyA' : 'KeyW', 1], [down + hold, i % 2 ? 'KeyA' : 'KeyW', 0]] as InputEvent[];
      }).flat();
      const { reasons, scores } = checkHumanTiming(human);
      expect(scores.timerStepMs).toBe(100);
      expect(reasons.map((r) => r.code)).not.toContain('instant-presses');
      expect(reasons.map((r) => r.code)).not.toContain('repeated-timings');
      expect(timerStepMs(recording('ride-1', { seconds: 120, seed: 5 }).flatMap((b) => b.inputs.map((e) => e[0])))).toBe(0); // a fine-grained clock
      expect(timerStepMs([1000 / 60, 2000 / 60, 50, 100, 1000 / 6, 200, 250, 300].map((t) => Math.round(t * 10) / 10))).toBeGreaterThanOrEqual(10);
    });

    it('has no opinion below 8 presses (a 60 s demo ride must not flag itself)', () => {
      const few: InputEvent[] = [[0, 'KeyW', 1], [1000, 'KeyW', 0], [2000, 'KeyW', 1], [3000, 'KeyW', 0]];
      expect(checkHumanTiming(few)).toEqual({ reasons: [], scores: { presses: 2, minHoldCv: null, repeatShare: null, instantShare: null, timerStepMs: 0 } });
    });

    it('pairs presses with their releases per key; a press still held at the end is dropped', () => {
      const h = holdsByCode([[0, 'KeyW', 1], [50, 'KeyA', 1], [120, 'KeyA', 0], [900, 'KeyW', 0], [1000, 'KeyD', 1], [1100, 'KeyW', 0]]);
      expect(Object.fromEntries(h)).toEqual({ KeyA: [70], KeyW: [900] });
    });

    it('jittered human timing passes every timing check', () => {
      const events = recording('ride-1', { seconds: 300, seed: 42 }).flatMap((b) => b.inputs);
      const { reasons, scores } = checkHumanTiming(events);
      expect(reasons).toEqual([]);
      expect(scores.minHoldCv).toBeGreaterThan(2 * HOLD_CV_MIN);
      expect(scores.repeatShare).toBeLessThan(REPEAT_SHARE_MAX / 4);
    });
  });

  it('an admin override sets the status by hand, keeps the judged reasons, shows who and why; only verified / rejected', () => {
    const v = judge(180, 2400, { inputs: 'bot' });
    expect(v.isOverridden).toBe(false);
    v.override(VerdictStatus.Verified, 'ADMIN', 'n'.repeat(600), at(200));
    expect(v.isOverridden).toBe(true);
    expect(v.toDto()).toMatchObject({ status: 'verified', override: { by: 'ADMIN', at: at(200).getTime() } });
    expect(v.toDto().override?.note).toHaveLength(500);
    expect(v.reasons.length).toBeGreaterThan(0);
    expect(() => v.override(VerdictStatus.Flagged as never, 'ADMIN', null, at(201))).toThrow(/verified or rejected/);
  });

  it('restores from a snapshot unchanged', () => {
    const v = judge(60, 800);
    expect(RideVerdict.restore(v.snapshot()).snapshot()).toEqual(v.snapshot());
    expect(RULES).toBeDefined();
  });
});
