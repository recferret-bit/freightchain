import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { RideBatch, type BatchBody, type InputEvent } from '../../../src/domain/telemetry/ride-batch.entity.js';
import { checkHumanTiming, holdsByCode, timerStepMs } from '../../../src/domain/verdict/human-checks.js';
import { RideVerdict } from '../../../src/domain/verdict/ride-verdict.entity.js';
import { HOLD_CV_MIN, REPEAT_SHARE_MAX, RULES_VERSION } from '../../../src/domain/verdict/verdict-rules.js';
import { VerdictStatus } from '../../../src/domain/verdict/verdict.dto.js';
import { hashBatch, recording, type RecordingOptions } from '../../support/recording.js';
import { checkChallenges } from '../../../src/domain/verdict/challenge-checks.js';
import { expectedLink } from '../../../src/domain/verdict/recording-checks.js';
import type { RideChallenge } from '../../../src/domain/rides/ride-challenge.js';

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
    it('a batch the client could not hash (hash null, the next one chained to unhashed-<seq>) only FLAGS – the server hashed it on arrival', () => {
      const unhashed = (b: BatchBody[]) => {
        const out = b.map((x) => ({ ...x }));
        out[1] = { ...out[1]!, hash: null };
        for (let i = 2; i < out.length; i++) { out[i] = { ...out[i]!, prevHash: i === 2 ? 'unhashed-1' : (out[i - 1]!.hash as string) }; out[i]!.hash = hashBatch(out[i]!); }
        return out;
      };
      const v = RideVerdict.judge(completedRide(60, 800), unhashed(recording('ride-1', { seconds: 60, distance: 800 })).map((b) => RideBatch.accept('ride-1', b, hashBatch(b), T0)), T0);
      expect(v.status).toBe(VerdictStatus.Flagged);
      expect(v.reasons).toEqual([{ code: 'unhashed-batch', detail: 'batch 1 arrived without the client\'s hash', severity: 'flag' }]);
      expect(v.snapshot().scores.recording.unhashed).toBe(1);
      expect(expectedLink({ seq: 4, prevHash: '', hash: null, hashOk: false, t0: 0, t1: 1, summary: { v: 1, samples: 0, first: null, last: null, maxSpeed: 0, worstStep: null, fault: null, inputs: [], world: null } })).toBe('unhashed-4');
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
    it('a jump ACROSS a batch boundary (last sample of one, first of the next) is a teleport too', () => expect(codes(judge(60, 800, {}, patch(2, 0, 1, 9000)))).toContain('teleport'));
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
    it("the phone's events (phone:…) are not inputs: they neither fake an input nor disturb the human timing", () => {
      const phone = (b: BatchBody[]) => {   // phone events in every batch, the chain re-hashed
        const out: BatchBody[] = [];
        for (const x of b) { const body = { ...x, prevHash: out.length ? (out[out.length - 1]!.hash as string) : x.prevHash, inputs: [...x.inputs, [x.t0 + 0.5, 'phone:zoom-in', 1] as [number, string, 0 | 1], [x.t0 + 0.5, 'phone:pan', 1] as [number, string, 0 | 1], [x.t0 + 0.5, 'phone:pan', 0] as [number, string, 0 | 1]] }; out.push({ ...body, hash: hashBatch(body) }); }
        return out;
      };
      expect(codes(judge(60, 800, { inputs: 'none' }, phone))).toContain('no-inputs');
      const plain = judge(120, 1600), withPhone = judge(120, 1600, {}, phone);
      expect(codes(withPhone)).toEqual([]);
      expect(withPhone.snapshot().scores.human).toEqual(plain.snapshot().scores.human);
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

describe('challenge channel (checkChallenges)', () => {
  const prompt = (id: string, issuedMs: number, codes: readonly string[] = ['KeyL']): RideChallenge => ({ id, action: 'test', issuedMs, deadlineMs: issuedMs + 20_000, codes });
  const press = (t: number, code: string): InputEvent[] => [[t, code, 1], [t + 120, code, 0]];
  const END = 300_000;

  it('answered within the window by any of the prompt\'s codes: no reason, the reactions scored', () => {
    const r = checkChallenges([prompt('a', 10_000), prompt('b', 60_000, ['KeyR', 'btn:wiper']), prompt('c', 100_000, ['KeyC'])], [...press(10_600, 'KeyL'), ...press(61_000, 'btn:wiper'), ...press(119_000, 'KeyC')], END);
    expect(r.reasons).toEqual([]);
    expect(r.scores).toEqual({ issued: 3, answered: 3, missed: 0, tooFast: 0, medianReactionMs: 1000 });
  });

  it('a press before the prompt, after its deadline, or of another key does not count – one miss flags', () => {
    const r = checkChallenges([prompt('a', 10_000), prompt('b', 60_000)], [...press(9_500, 'KeyL'), ...press(30_100, 'KeyL'), ...press(61_000, 'KeyR'), ...press(62_000, 'KeyL')], END);
    expect(r.reasons).toEqual([{ code: 'challenge-missed', detail: '1 of 2 dispatch prompts went unanswered', severity: 'flag' }]);
    expect(r.scores).toMatchObject({ issued: 2, answered: 1, missed: 1 });
  });

  it('half or more of 3+ prompts ignored REJECTS (challenges-ignored); fewer only flag', () => {
    const three = [prompt('a', 10_000), prompt('b', 60_000), prompt('c', 100_000)];
    expect(checkChallenges(three, [], END).reasons).toEqual([{ code: 'challenges-ignored', detail: '3 of 3 dispatch prompts went unanswered', severity: 'reject' }]);
    expect(checkChallenges(three, press(10_500, 'KeyL'), END).reasons[0]).toMatchObject({ code: 'challenges-ignored', severity: 'reject' });
    expect(checkChallenges(three, [...press(10_500, 'KeyL'), ...press(60_500, 'KeyL')], END).reasons[0]).toMatchObject({ code: 'challenge-missed', severity: 'flag' });
    expect(checkChallenges([prompt('a', 10_000), prompt('b', 60_000)], [], END).reasons[0]).toMatchObject({ code: 'challenge-missed', severity: 'flag' }); // under 3 issued: never a reject
  });

  it('answered faster than a person can read (median under 80 ms, 2+ answers) flags challenge-reflex; one fast answer alone does not', () => {
    const two = [prompt('a', 10_000), prompt('b', 60_000)];
    const r = checkChallenges(two, [...press(10_010, 'KeyL'), ...press(60_020, 'KeyL')], END);
    expect(r.reasons).toEqual([{ code: 'challenge-reflex', detail: 'prompts answered 15 ms after they were issued – faster than a person can read them', severity: 'flag' }]);
    expect(r.scores).toMatchObject({ tooFast: 2, medianReactionMs: 15 });
    expect(checkChallenges(two, [...press(10_010, 'KeyL'), ...press(60_700, 'KeyL')], END).reasons).toEqual([]); // median 355 ms
    expect(checkChallenges([prompt('a', 10_000)], press(10_010, 'KeyL'), END).reasons).toEqual([]);
  });

  it('a prompt whose window was still open when the ride ended is not judged; no prompts = nothing to say', () => {
    expect(checkChallenges([prompt('a', 10_000), prompt('late', 290_000)], press(10_500, 'KeyL'), END).scores).toMatchObject({ issued: 1, answered: 1, missed: 0 });
    expect(checkChallenges([], [], END)).toEqual({ reasons: [], scores: { issued: 0, answered: 0, missed: 0, tooFast: 0, medianReactionMs: null } });
  });

  it('RideVerdict.judge reads the prompts off the ride: ignored prompts reject an otherwise clean recording', () => {
    const ride = completedRide(120, 1600);
    const withPrompts = Ride.restore({ ...ride.snapshot(), challenges: [prompt('a', 20_000), prompt('b', 50_000), prompt('c', 80_000)] });
    const v = RideVerdict.judge(withPrompts, stored(recording('ride-1', { seconds: 120, distance: 1600 })), at(121));
    expect(v.status).toBe(VerdictStatus.Rejected);
    expect(codes(v)).toEqual(['challenges-ignored']);
    expect(v.snapshot().scores.challenges).toEqual({ issued: 3, answered: 0, missed: 3, tooFast: 0, medianReactionMs: null });
    const answered = RideVerdict.judge(withPrompts, stored(recording('ride-1', { seconds: 120, distance: 1600, answers: [{ atMs: 20_700, code: 'KeyL' }, { atMs: 50_900, code: 'KeyL' }, { atMs: 81_200, code: 'KeyL' }] })), at(121));
    expect(answered.status).toBe(VerdictStatus.Verified);
  });
});
