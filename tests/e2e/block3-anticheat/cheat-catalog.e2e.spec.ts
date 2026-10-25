import { describe, expect, it } from 'vitest';
import { enforceBatchMacMessage } from '../../../frontend/client/shared/batch-mac.js';
import { REPLAY_SIM_HZ, stepAt30Hz } from '../../../frontend/client/shared/physics.js';
import { judgeWorldDigest, requireNamedStreams, stepInpAt30Hz, worldDigest32 } from '../../../frontend/client/shared/telemetry-codec.js';
import { classifyHumanness, intervalsMs, type HumannessInput, type InpEvent } from '../../../backend/server/src/domain/anticheat/humanness.js';
import { TRACE_SIMILARITY_THRESHOLD, clusterAlert, flagSimilarTraces } from '../../../backend/server/src/domain/anticheat/trace-cluster.js';
import { TRUST_INITIAL, applyTrust } from '../../../backend/server/src/domain/anticheat/trust-score.js';
import { macStructurallyValid } from '../../../backend/server/src/domain/minigames/mac.js';
import { PAUSE_MAX_COUNT, pauseBoundFlags, pauseVerdict, slowMotionVerdict } from '../../../backend/server/src/domain/rides/pause-bounds.js';
import { summariseBatch, type BatchSummary } from '../../../backend/server/src/domain/telemetry/batch-summary.js';
import type { BatchFacts } from '../../../backend/server/src/domain/telemetry/ride-batch.entity.js';
import { SAMPLE_HZ } from '../../../backend/server/src/domain/telemetry/telemetry-rules.js';
import { checkChain, checkMotion, checkSamples, expectedLink } from '../../../backend/server/src/domain/verdict/recording-checks.js';
import { RULES_VERSION } from '../../../backend/server/src/domain/verdict/verdict-rules.js';
import { checkWorld } from '../../../backend/server/src/domain/verdict/world-checks.js';
import { STREAMS_COMPRESSED_MAX, STREAMS_UNCOMPRESSED_MAX, assertBatchStreams } from '../../../backend/server/src/application/telemetry/batch-streams.js';

const FRAME_US = 16667;
const ride = { rideId: 'ride-1', driveSeconds: 10, distance: 60 };

function sample(t: number, s: number, v: number): number[] {
  return [t, s, 2.4, 0, v, 1800, 6, 100, 0.6, 0, 0, 0];
}

function batch(summary: BatchSummary, seq = 0): BatchFacts {
  return { seq, prevHash: 'ride-1', hash: 'h', hashOk: true, t0: 0, t1: 15, summary };
}

function blankSummary(): BatchSummary {
  return { v: 1, samples: 0, first: null, last: null, maxSpeed: 0, worstStep: null, fault: null, inputs: [], world: null };
}

function chainRow(seq: number, prevHash: string, hash: string | null, hashOk: boolean): BatchFacts {
  return { seq, prevHash, hash, hashOk, t0: 0, t1: 1, summary: blankSummary() };
}

function longitudinal(over: Record<string, unknown> = {}) {
  return { v: 10, gear: 6, gas: 1, brake: 0, clutch: 0, rpm: 1600, engineOn: true, park: false, rev: false, ...over };
}

function offGrid(tUs: number): number {
  return tUs % FRAME_US === 0 ? tUs + 3 : tUs;
}

function humanEvents(): InpEvent[] {
  const gapsMs = [180, 95, 420, 140, 760, 210, 330, 110, 890, 260, 540, 150];
  let tUs = 2500;
  return gapsMs.map((gap, i) => {
    tUs = offGrid(tUs + gap * 1000);
    return { tUs, code: i === 3 ? 'steer' : 'gas', down: true, trusted: true };
  });
}

function humanLike(): HumannessInput {
  return {
    events: humanEvents(),
    stimuli: [280, 460].map((rt, i) => ({ visibleAtUs: i * 1_000_000, respondedAtUs: i * 1_000_000 + rt * 1000 })),
    holdsMs: [90, 160, 240, 410],
  };
}

function codes(reasons: readonly { code: string }[]): string[] {
  return reasons.map((reason) => reason.code);
}

describe('cheat catalog shipped outcomes', () => {
  it('[CHEAT-#01] a sample faster than the governor is over-governor', () => {
    const summary = summariseBatch(0, 0, 1, [sample(0, 0, 32), sample(0.1, 3.2, 32)], []);
    expect(summary.fault).toBeNull();
    const reasons = checkSamples([batch(summary)]).reasons;
    expect(codes(reasons).some((code) => code.includes('over-governor'))).toBe(true);
  });

  it('[CHEAT-#02] cruise locked under the governor is not rejected', () => {
    const rows = [0, 1, 2, 3].map((i) => sample(i * 0.1, i * 2.2, 22));
    const summary = summariseBatch(0, 0, 1, rows, []);
    expect(summary.maxSpeed).toBeLessThanOrEqual(28);
    expect(checkSamples([batch(summary)]).reasons).toEqual([]);
  });

  it('[CHEAT-#03] power ×1.5 does not throw', () => {
    const state = longitudinal();
    expect(() => stepAt30Hz(state, undefined, 1.5)).not.toThrow();
    const stepped = stepAt30Hz(state, undefined, 1.5);
    expect(Number.isFinite(stepped.v)).toBe(true);
  });

  it('[CHEAT-#04] brakeEfficiency 0.5 returns a state', () => {
    const stepped = stepAt30Hz(longitudinal({ gas: 0, brake: 1 }), undefined, 1, 0.5);
    expect(Number.isFinite(stepped.v)).toBe(true);
    expect(stepped.brake).toBe(1);
  });

  it('[CHEAT-#05] the 30 Hz stepper has no lateral d', () => {
    expect(stepAt30Hz(longitudinal())).not.toHaveProperty('d');
  });

  it('[CHEAT-#06] about 80 m in 0.1 s is a teleport', () => {
    const summary = summariseBatch(0, 0, 1, [sample(0, 0, 20), sample(0.1, 80, 20)], []);
    expect(summary.fault).toBeNull();
    expect(codes(checkSamples([batch(summary)]).reasons)).toContain('teleport');
  });

  it('[CHEAT-#07] a lateral jump is not a 30 Hz stepper field', () => {
    const stepped = stepAt30Hz(longitudinal({ d: -2.4 }));
    expect(stepped).not.toHaveProperty('d');
  });

  it('[CHEAT-#08] position ahead of the speedometer is speed-mismatch', () => {
    const ahead = summariseBatch(0, 0, 1, [sample(0, 0, 10), sample(0.1, 60, 10)], []);
    const matched = summariseBatch(0, 0, 1, [sample(0, 0, 10), sample(0.1, 1, 10)], []);
    expect(codes(checkMotion(ride, [batch(ahead)]).reasons)).toContain('speed-mismatch');
    expect(codes(checkMotion(ride, [batch(matched)]).reasons)).not.toContain('speed-mismatch');
  });

  it('[CHEAT-#09] accel-without-gas is a world check, not a pause check', () => {
    const summary: BatchSummary = {
      v: 1, samples: 2, first: [0, 0], last: [0.1, 1], maxSpeed: 10, worstStep: null, fault: null, inputs: [],
      world: { v: 1, holes: [], offroad: [], gasless: [[0.1, 2.5]] },
    };
    const judged = checkWorld([{ summary }]);
    expect(codes(judged.reasons)).toContain('accel-without-gas');
    expect(judged.reasons.find((reason) => reason.code === 'accel-without-gas')?.severity).toBe('reject');
    expect(codes(pauseVerdict('enforce', { count: 4, seconds: 301 }))).not.toContain('accel-without-gas');
  });

  it('[CHEAT-#10] enforce slow-mo rejects time-dilation and the live rate stays 10 Hz', () => {
    const reasons = slowMotionVerdict('enforce', 30, 120_000);
    expect(codes(reasons)).toEqual(['time-dilation']);
    expect(reasons[0]?.severity).toBe('reject');
    expect(REPLAY_SIM_HZ).toBe(10);
    expect(SAMPLE_HZ).toBe(10);
  });

  it('[CHEAT-#11] rules 7 leaves over-limit pauses silent when off and rejects them when enforced', () => {
    expect(RULES_VERSION).toBe(7);
    expect(pauseVerdict('off', { count: 4, seconds: 301 })).toEqual([]);
    const enforced = pauseVerdict('enforce', { count: 4, seconds: 301 });
    expect(codes(enforced).sort()).toEqual(['pause-limit', 'pause-time']);
    expect(enforced.every((reason) => reason.severity === 'reject')).toBe(true);
  });

  it('[CHEAT-#12] a sample outside order is sample-out-of-order', () => {
    const summary = summariseBatch(0, 0, 2, [sample(0, 0, 10), sample(0.2, 2, 10), sample(0.1, 1, 10)], []);
    expect(summary.fault?.code).toBe('sample-out-of-order');
    expect(codes(checkSamples([batch(summary)]).reasons)).toContain('sample-out-of-order');
  });

  it('[CHEAT-#13] a silent pause tally adds no pause-limit', () => {
    expect(PAUSE_MAX_COUNT).toBe(3);
    expect(codes(pauseVerdict('enforce', { count: 0, seconds: 0 }))).not.toContain('pause-limit');
    expect(pauseBoundFlags({ count: 0, seconds: 0 })).toEqual([]);
  });

  it('[CHEAT-#14] checkSamples does not return pause-limit', () => {
    const summary = summariseBatch(0, 0, 1, [sample(0, 0, 10), sample(0.1, 1, 10)], []);
    expect(codes(checkSamples([batch(summary)]).reasons)).not.toContain('pause-limit');
  });

  it('[CHEAT-#15] a sequence that does not start at 0 is missing-batches', () => {
    const reasons = checkChain(ride, [chainRow(1, 'ride-1', 'h', true)]);
    expect(codes(reasons)).toContain('missing-batches');
    expect(reasons.find((reason) => reason.code === 'missing-batches')?.severity).toBe('reject');
  });

  it('[CHEAT-#16] a hash the server could not reproduce is hash-mismatch', () => {
    const reasons = checkChain(ride, [chainRow(0, 'ride-1', 'deadbeef', false)]);
    expect(codes(reasons)).toContain('hash-mismatch');
    expect(reasons.find((reason) => reason.code === 'hash-mismatch')?.severity).toBe('reject');
  });

  it('[CHEAT-#17] no batches is no-recording', () => {
    expect(codes(checkChain(ride, []))).toEqual(['no-recording']);
  });

  it('[CHEAT-#18] a skipped seq is missing-batches', () => {
    const reasons = checkChain(ride, [chainRow(0, 'ride-1', 'hash-a', true), chainRow(2, 'hash-a', 'hash-c', true)]);
    expect(codes(reasons)).toContain('missing-batches');
    expect(reasons.find((reason) => reason.code === 'missing-batches')?.detail).toContain('1');
  });

  it('[CHEAT-#19] a wrong prevHash is chain-broken', () => {
    const reasons = checkChain(ride, [chainRow(0, 'ride-1', 'hash-a', true), chainRow(1, 'not-the-previous', 'hash-b', true)]);
    expect(codes(reasons)).toContain('chain-broken');
  });

  it('[CHEAT-#20] an unreproduced hash names hash-mismatch', () => {
    const reasons = checkChain(ride, [chainRow(0, 'ride-1', 'ee', false)]);
    expect(reasons.find((reason) => reason.code === 'hash-mismatch')?.detail).toContain('0');
  });

  it('[CHEAT-#21] a ride-id chain with matching hashes adds no chain reason', () => {
    const reasons = checkChain(ride, [chainRow(0, 'ride-1', 'hash-a', true), chainRow(1, 'hash-a', 'hash-b', true)]);
    expect(reasons).toEqual([]);
  });

  it('[CHEAT-#22] a null client hash flags unhashed-batch and does not reject', () => {
    const reasons = checkChain(ride, [chainRow(0, 'ride-1', null, false)]);
    expect(reasons.map((reason) => reason.severity)).toEqual(['flag']);
    expect(codes(reasons)).toEqual(['unhashed-batch']);
  });

  it('[CHEAT-#23] expectedLink of an unhashed batch is the unhashed seq token', () => {
    const first = chainRow(0, 'ride-1', null, false);
    expect(expectedLink(first)).toBe('unhashed-0');
    const reasons = checkChain(ride, [first, chainRow(1, 'unhashed-0', 'hash-b', true)]);
    expect(codes(reasons)).not.toContain('chain-broken');
    expect(codes(reasons)).toContain('unhashed-batch');
  });

  it('[CHEAT-#24] the first batch must chain to the ride id', () => {
    const reasons = checkChain(ride, [chainRow(0, 'other-ride', 'hash-a', true)]);
    expect(codes(reasons)).toContain('chain-broken');
    expect(codes(reasons)).not.toContain('hash-mismatch');
  });

  it('[CHEAT-#25] the 30 Hz stepper has no hull field', () => {
    expect(stepAt30Hz(longitudinal())).not.toHaveProperty('hull');
  });

  it('[CHEAT-#26] classifyHumanness does not return traffic-collision-ignored', () => {
    const stepped = stepAt30Hz(longitudinal());
    expect(stepped).not.toHaveProperty('traffic');
    expect(classifyHumanness(humanLike()).reasons).not.toContain('traffic-collision-ignored');
  });

  it('[CHEAT-#27] the stepper returns longitudinal state only', () => {
    expect(Object.keys(stepAt30Hz(longitudinal())).sort()).toEqual(['brake', 'clutch', 'engineOn', 'gas', 'gear', 'park', 'rev', 'rpm', 'v']);
  });

  it('[CHEAT-#28] the stepper has no crash counter', () => {
    expect(stepAt30Hz(longitudinal())).not.toHaveProperty('crashesVehicle');
  });

  it('[CHEAT-#29] the stepper does not model building crashes', () => {
    expect(stepAt30Hz(longitudinal())).not.toHaveProperty('simulatedCrashesBuilding');
  });

  it('[CHEAT-#30] a damage cut is not a humanness reject', () => {
    const result = classifyHumanness(humanLike());
    expect(result.verdict).toBe('verified');
    expect(result.reasons.some((reason) => reason.includes('damage'))).toBe(false);
  });

  it('[CHEAT-#31] classifyHumanness does not return obstacle-no-impact', () => {
    const reasons = classifyHumanness(humanLike()).reasons;
    expect(reasons).not.toContain('obstacle-no-impact');
    expect(reasons).not.toContain('obstacle-ignored');
  });

  it('[CHEAT-#32] a red light is not a humanness reject', () => {
    const result = classifyHumanness(humanLike());
    expect(result.verdict).not.toBe('rejected');
    expect(result.reasons.some((reason) => reason.includes('red'))).toBe(false);
  });

  it('[CHEAT-#33] classifyHumanness does not return donated-obstacle-ignored', () => {
    const reasons = classifyHumanness(humanLike()).reasons;
    expect(reasons).not.toContain('donated-obstacle-ignored');
    expect(reasons).not.toContain('event-unapplied');
  });

  it('[CHEAT-#34] a run of at least 50 matching intervals is physically-impossible-replay', () => {
    const events = Array.from({ length: 51 }, (_, i) => ({ tUs: offGrid(1000 + i * 250_000), code: 'gas', down: true, trusted: true }));
    const otherIntervalsMs = intervalsMs(events);
    const result = classifyHumanness({ events, otherIntervalsMs });
    expect(result.features.f4MatchRun).toBeGreaterThanOrEqual(50);
    expect(result.verdict).toBe('rejected');
    expect(result.reasons).toContain('physically-impossible-replay');
  });

  it('[CHEAT-#35] a 0.15 m pose shift is not a humanness input', () => {
    expect(stepAt30Hz(longitudinal({ d: 0.15 }))).not.toHaveProperty('d');
    const input = humanLike();
    expect(classifyHumanness(input)).toEqual(classifyHumanness(input));
    expect(classifyHumanness(input).verdict).toBe('verified');
  });

  it('[CHEAT-#36] the same wallet is ignored by flagSimilarTraces', () => {
    const intervals = Array.from({ length: 40 }, () => 180);
    expect(flagSimilarTraces([
      { rideId: 'r1', wallet: 'same', intervalsMs: intervals },
      { rideId: 'r2', wallet: 'same', intervalsMs: intervals },
    ])).toEqual([]);
  });

  it('[CHEAT-#37] different wallets over the similarity threshold are flagged', () => {
    const intervals = Array.from({ length: 40 }, () => 180);
    const flags = flagSimilarTraces([
      { rideId: 'r1', wallet: 'wallet-a', intervalsMs: intervals },
      { rideId: 'r2', wallet: 'wallet-b', intervalsMs: intervals },
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.similarity).toBeGreaterThanOrEqual(TRACE_SIMILARITY_THRESHOLD);
  });

  it('[CHEAT-#38] a frame-grid bot is rejected physically-impossible-frame-grid', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({ tUs: i * FRAME_US, code: 'gas', down: true, trusted: true }));
    const result = classifyHumanness({ events });
    expect(result.verdict).toBe('rejected');
    expect(result.reasons).toContain('physically-impossible-frame-grid');
  });

  it('[CHEAT-#39] a human-like varied trace is verified', () => {
    const result = classifyHumanness(humanLike());
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.verdict).toBe('verified');
  });

  it('[CHEAT-#40] stepInpAt30Hz returns a finite v', () => {
    const stepped = stepInpAt30Hz(null, [{ tick: 0, gas: 0.4, brake: 0, gear: 4 }], 10);
    expect(Number.isFinite(stepped.v)).toBe(true);
  });

  it('[CHEAT-#41] a perfect profile step is a number and not a humanness verdict', () => {
    const stepped = stepInpAt30Hz(null, [{ tick: 0, gas: 1, brake: 0, gear: 6 }], 30);
    expect(typeof stepped.v).toBe('number');
    expect(Number.isFinite(stepped.v)).toBe(true);
    expect(stepped).not.toHaveProperty('verdict');
  });

  it('[CHEAT-#42] TRUST_INITIAL is 60', () => {
    expect(TRUST_INITIAL).toBe(60);
  });

  it('[CHEAT-#43] applyTrust is pure', () => {
    const score = 60;
    expect(applyTrust(score, 'verified')).toBe(65);
    expect(score).toBe(60);
    expect(applyTrust(60, 'verified')).toBe(applyTrust(60, 'verified'));
  });

  it('[CHEAT-#44] STREAMS_COMPRESSED_MAX is 65536', () => {
    expect(STREAMS_COMPRESSED_MAX).toBe(65536);
    expect(STREAMS_COMPRESSED_MAX).toBe(64 * 1024);
  });

  it('[CHEAT-#45] an absent stream payload is under the uncompressed cap and is not inflated', () => {
    expect(STREAMS_UNCOMPRESSED_MAX).toBe(256 * 1024);
    expect(assertBatchStreams(undefined, () => { throw new Error('inflate'); })).toBeUndefined();
  });

  it('[CHEAT-#46] requireNamedStreams throws when inp is missing', () => {
    expect(() => requireNamedStreams({ clk: 'aa', chk: 'bb', mg: 'cc', env: 'dd' })).toThrow(/inp/);
  });

  it('[CHEAT-#47] one short world-digest mismatch flags and does not reject', () => {
    expect(judgeWorldDigest([{ tSec: 1.5, client: 11, server: 22 }])).toBe('flag');
  });

  it('[CHEAT-#48] nine fast reactions do not reject and ten do', () => {
    const stimuli = (n: number) => Array.from({ length: n }, (_, i) => ({ visibleAtUs: i * 2_000_000, respondedAtUs: i * 2_000_000 + 50_000 }));
    const nine = classifyHumanness({ events: [], stimuli: stimuli(9) });
    expect(nine.verdict).not.toBe('rejected');
    expect(nine.reasons).not.toContain('physically-impossible-rt');
    const ten = classifyHumanness({ events: [], stimuli: stimuli(10) });
    expect(ten.verdict).toBe('rejected');
    expect(ten.reasons).toContain('physically-impossible-rt');
  });

  it('[CHEAT-#49] replaying another ride intervals of run >= 50 rejects', () => {
    const events = Array.from({ length: 51 }, (_, i) => ({ tUs: offGrid(4000 + i * 180_000), code: 'gas', down: true, trusted: true }));
    const result = classifyHumanness({ events, otherIntervalsMs: intervalsMs(events) });
    expect(result.features.f4MatchRun).toBeGreaterThanOrEqual(50);
    expect(result.verdict).toBe('rejected');
    expect(result.reasons).toContain('physically-impossible-replay');
  });

  it('[CHEAT-#50] the stepper has no collision flag', () => {
    const stepped = stepAt30Hz(longitudinal());
    expect(stepped).not.toHaveProperty('collision');
    expect(typeof stepped.v).toBe('number');
  });

  it('[CHEAT-#51] worldDigest32 changes when an id is removed and a sustained mismatch rejects', () => {
    expect(worldDigest32(['station', 'barrier', 'sign'])).not.toBe(worldDigest32(['station', 'barrier']));
    const judged = judgeWorldDigest([
      { tSec: 0, client: 1, server: 2 },
      { tSec: 5, client: 1, server: 2 },
      { tSec: 10, client: 1, server: 2 },
    ]);
    expect(judged).toBe('reject');
  });

  it('[CHEAT-#52] untrusted input without an impossibility is review, not a reject', () => {
    const input = humanLike();
    input.events = input.events.map((event, i) => (i === 0 ? { ...event, trusted: false } : event));
    const result = classifyHumanness(input);
    expect(result.verdict).toBe('flagged_for_review');
    expect(result.reasons).toEqual(['untrusted-input']);
  });

  it('[CHEAT-#53] a mac of 43 base64url characters is structural only', () => {
    expect(macStructurallyValid('A'.repeat(43))).toBe(true);
    expect(macStructurallyValid(`${'A'.repeat(42)}_`)).toBe(true);
    expect(macStructurallyValid('A'.repeat(42))).toBe(false);
    expect(macStructurallyValid(`${'A'.repeat(42)}+`)).toBe(false);
    expect(macStructurallyValid.length).toBe(1);
  });

  it('[CHEAT-#54] the enforce mac message changes when the inp hash changes', () => {
    const left = enforceBatchMacMessage('ride', 1, 0, 30, 'a'.repeat(64), 'b'.repeat(64));
    const right = enforceBatchMacMessage('ride', 1, 0, 30, 'c'.repeat(64), 'b'.repeat(64));
    expect(left).not.toBe(right);
    expect(left.includes('a'.repeat(64))).toBe(true);
    expect(left).not.toBe('a'.repeat(64));
  });

  it('[CHEAT-#55] ten negative reaction times reject physically-impossible-rt', () => {
    const stimuli = Array.from({ length: 10 }, (_, i) => ({ visibleAtUs: 5_000_000 + i, respondedAtUs: 5_000_000 + i - 80_000 }));
    const result = classifyHumanness({ events: [], stimuli });
    expect(result.features.f2MedianRtMs).toBeLessThan(100);
    expect(result.verdict).toBe('rejected');
    expect(result.reasons).toContain('physically-impossible-rt');
  });

  it('[CHEAT-#56] powerFactor 3 still returns a numeric v', () => {
    const stepped = stepAt30Hz(longitudinal(), undefined, 3);
    expect(Number.isFinite(stepped.v)).toBe(true);
    expect(stepped).not.toHaveProperty('resim-mismatch');
  });

  it('[CHEAT-#57] trusted false is flagged_for_review untrusted-input', () => {
    const result = classifyHumanness({ events: [{ tUs: 2500, code: 'gas', down: true, trusted: false }] });
    expect(result.verdict).toBe('flagged_for_review');
    expect(result.reasons).toEqual(['untrusted-input']);
  });

  it('[CHEAT-#58] identical intervals on two wallets raise trace-cluster', () => {
    const intervals = Array.from({ length: 60 }, () => 220);
    const flags = flagSimilarTraces([
      { rideId: 'ride-a', wallet: 'wallet-a', intervalsMs: intervals },
      { rideId: 'ride-b', wallet: 'wallet-b', intervalsMs: intervals },
    ]);
    expect(flags).toHaveLength(1);
    expect(clusterAlert(flags)?.code).toBe('trace-cluster');
  });
});
