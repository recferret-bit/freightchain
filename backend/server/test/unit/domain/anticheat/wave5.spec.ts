import { readFileSync } from 'node:fs';
import { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { RULES_VERSION } from '../../../../src/domain/verdict/verdict-rules.js';
import { REPLAY_SIM_HZ, continueInpAt30Hz, enforceBatchMacMessage, judgeWorldDigest, stepInpAt30Hz, worldDigest32 } from '../../../../src/domain/shared/index.js';
import { revealRideSalts } from '../../../../src/application/rides/ride-salts.js';
import { classifyHumanness } from '../../../../src/domain/anticheat/humanness.js';
import { clusterAlert, flagSimilarTraces } from '../../../../src/domain/anticheat/trace-cluster.js';
import { inpPrunable } from '../../../../src/domain/anticheat/inp-retention.js';
import { TRUST_INITIAL, applyTrust, grantReleasable } from '../../../../src/domain/anticheat/trust-score.js';
import { pauseVerdict, slowMotionVerdict } from '../../../../src/domain/rides/pause-bounds.js';
import { assertTermsCurrent } from '../../../../src/domain/players/terms.js';
import { TermsGuard } from '../../../../src/presentation/common/guards/terms.guard.js';
import { assertEnforceBatch } from '../../../../src/application/telemetry/enforce-batch.js';
import { ForbiddenError } from '../../../../src/domain/shared/errors.js';
import { NodeHasher } from '../../../../src/infrastructure/crypto/node.hasher.js';
import type { Ride } from '../../../../src/domain/rides/ride.entity.js';

const hasher = new NodeHasher();
const HOUR_TICKS = 108_000;

describe('wave 5 enforce path', () => {
  it('keeps the live replay at 10 Hz and rules 7', () => {
    expect(REPLAY_SIM_HZ).toBe(10);
    expect(RULES_VERSION).toBe(7);
    const replay = readFileSync(new URL('../../../../src/domain/verdict/replay-engine.ts', import.meta.url), 'utf8');
    expect(replay).not.toContain('stepAt30Hz');
  });

  it('steps inp at 1/30 and matches at tick 108000, including a split re-sim', () => {
    const initial = { v: 0, gear: 1, gas: 0, brake: 0, clutch: 0, rpm: 800, engineOn: true, park: false, rev: false };
    const inp = [{ tick: 0, gas: 1, gear: 2 }, { tick: 40_000, gas: 0.4, brake: 0.1, gear: 4 }, { tick: 90_000, gas: 0, brake: 1, gear: 3 }];
    const whole = stepInpAt30Hz(initial, inp, HOUR_TICKS);
    const again = stepInpAt30Hz(initial, inp, HOUR_TICKS);
    expect(again).toEqual(whole);
    const mid = stepInpAt30Hz(initial, inp, 50_000);
    expect(continueInpAt30Hz(mid, inp, 50_000, HOUR_TICKS)).toEqual(whole);
  });

  it('re-derives the same traffic and hole salts from the session key', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(revealRideSalts(hasher, 'ride-1', key)).toEqual(revealRideSalts(hasher, 'ride-1', key));
    expect(revealRideSalts(hasher, 'ride-1', key).trafficSalt).not.toBe(revealRideSalts(hasher, 'ride-2', key).trafficSalt);
  });

  it('rejects a bad enforce MAC before inflate and accepts the real one', () => {
    const key = Buffer.alloc(32, 9).toString('base64');
    const ride = { id: 'ride-mac', sessionKey: key } as Ride;
    const named = { inp: 'aaaa', clk: 'bbbb', chk: 'cccc', mg: 'dddd', env: 'eeee', startTick: 0, endTick: 60 };
    const mac = hasher.hmacSha256Hex(Buffer.from(key, 'base64'), enforceBatchMacMessage(ride.id, 0, 0, 60, hasher.sha256Hex(named.inp), hasher.sha256Hex(named.chk)));
    const inflate = () => Buffer.from('ok');
    expect(() => assertEnforceBatch(hasher, ride, { seq: 0, prevHash: 'r', t0: 0, t1: 1, samples: [], inputs: [], hash: null, protocol: 2, mac: 'ab'.repeat(32), named }, undefined, inflate)).toThrow(expect.objectContaining({ errorCode: 'batch-mac-invalid' }));
    expect(() => assertEnforceBatch(hasher, ride, { seq: 0, prevHash: 'r', t0: 0, t1: 1, samples: [], inputs: [], hash: null, protocol: 2, mac, named }, undefined, inflate)).not.toThrow();
  });

  it('rejects a world digest that lasts 10 seconds and flags a shorter run', () => {
    const digest = worldDigest32(['hole-1', 'car-2']);
    expect(worldDigest32(['car-2', 'hole-1'])).toBe(digest);
    const other = worldDigest32(['hole-1']);
    expect(judgeWorldDigest([{ tSec: 0, client: other, server: digest }, { tSec: 5, client: other, server: digest }, { tSec: 10, client: other, server: digest }])).toBe('reject');
    expect(judgeWorldDigest([{ tSec: 0, client: other, server: digest }, { tSec: 1, client: other, server: digest }, { tSec: 2, client: other, server: digest }])).toBe('flag');
  });

  it('rejects pause abuse and slow motion only in enforce mode', () => {
    const tally = { count: 4, seconds: 301 };
    expect(pauseVerdict('shadow', tally).map((r) => r.severity)).toEqual(['flag', 'flag']);
    expect(pauseVerdict('enforce', tally).map((r) => r.severity)).toEqual(['reject', 'reject']);
    expect(pauseVerdict('off', tally)).toEqual([]);
    const slow = slowMotionVerdict('enforce', 30 * 30, 120_000);
    expect(slow.map((r) => [r.code, r.severity])).toEqual([['time-dilation', 'reject']]);
    expect(slowMotionVerdict('shadow', 30 * 30, 120_000).map((r) => r.severity)).toEqual(['flag']);
    expect(slowMotionVerdict('off', 30 * 30, 120_000)).toEqual([]);
  });
});

describe('wave 5 humanness, trust, and terms', () => {
  it('rejects the five physical-impossibility cases and reviews a borderline or untrusted trace', () => {
    const rt = classifyHumanness({ events: [{ tUs: 1, code: 'KeyW', down: true, trusted: true }], stimuli: Array.from({ length: 10 }, () => ({ visibleAtUs: 0, respondedAtUs: 50_000 })) });
    expect(rt.verdict).toBe('rejected');
    expect(rt.reasons).toContain('physically-impossible-rt');
    const holds = classifyHumanness({ events: [{ tUs: 1, code: 'KeyW', down: true }], holdsMs: Array.from({ length: 50 }, () => 100) });
    expect(holds.reasons).toContain('physically-impossible-holds');
    const frames = classifyHumanness({ events: Array.from({ length: 10 }, (_, i) => ({ tUs: 16667 * i, code: 'KeyW', down: i % 2 === 0, trusted: true })) });
    expect(frames.reasons).toContain('physically-impossible-frame-grid');
    const gaps = Array.from({ length: 50 }, () => 40);
    const copied = classifyHumanness({ events: [{ tUs: 1, code: 'KeyW', down: true }, { tUs: 2, code: 'KeyW', down: false }], otherIntervalsMs: gaps });
    const withMatch = classifyHumanness({ events: Array.from({ length: 51 }, (_, i) => ({ tUs: i * 40_000, code: 'KeyW', down: true, trusted: true })), otherIntervalsMs: gaps });
    expect(withMatch.reasons).toContain('physically-impossible-replay');
    expect(copied.verdict).not.toBe('rejected');
    const teleport = classifyHumanness({ events: [{ tUs: 5, code: 'KeyW', down: true, trusted: true }], pointers: [{ points: 0 }, { points: 0 }, { points: 0 }] });
    expect(teleport.reasons).toContain('physically-impossible-teleport');
    const untrusted = classifyHumanness({ events: [{ tUs: 5, code: 'steer', down: true, trusted: false }, { tUs: 80_000, code: 'KeyW', down: true, trusted: true }] });
    expect(untrusted.verdict).toBe('flagged_for_review');
    expect(untrusted.reasons).not.toContain('physically-impossible-rt');
    const metronome = Array.from({ length: 12 }, (_, i) => ({ tUs: i * 100_000, code: 'KeyW', down: true, trusted: true }));
    const borderline = classifyHumanness({ events: metronome });
    expect(borderline.score).toBeGreaterThanOrEqual(40);
    expect(borderline.score).toBeLessThan(70);
    expect(borderline.verdict).toBe('flagged_for_review');
  });

  it('flags a top-20 pair over the similarity threshold and keeps inp until payout', () => {
    const intervals = Array.from({ length: 20 }, () => 33);
    const flags = flagSimilarTraces([{ rideId: 'a', wallet: 'w1', intervalsMs: intervals }, { rideId: 'b', wallet: 'w2', intervalsMs: intervals }]);
    expect(flags).toHaveLength(1);
    expect(clusterAlert(flags)?.code).toBe('trace-cluster');
    expect(flagSimilarTraces([{ rideId: 'a', wallet: 'w1', intervalsMs: intervals }, { rideId: 'c', wallet: 'w1', intervalsMs: intervals }])).toEqual([]);
    const old = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-05-01T00:00:00Z');
    expect(inpPrunable({ rideId: 'a', inpAt: old, payoutFinalizedAt: new Date('2026-04-01T00:00:00Z') }, now)).toBe(true);
    expect(inpPrunable({ rideId: 'a', inpAt: old, payoutFinalizedAt: null }, now)).toBe(false);
    expect(inpPrunable({ rideId: 'a', inpAt: new Date('2026-04-20T00:00:00Z'), payoutFinalizedAt: old }, now)).toBe(false);
  });

  it('starts trust at 60, holds a grant for 48 hours, and refuses stale terms', () => {
    expect(TRUST_INITIAL).toBe(60);
    expect(applyTrust(TRUST_INITIAL, 'verified')).toBe(75);
    expect(applyTrust(10, 'rejected')).toBe(0);
    const heldAt = new Date('2026-10-01T00:00:00Z');
    const early = new Date(heldAt.getTime() + 47 * 3600 * 1000);
    const ready = new Date(heldAt.getTime() + 48 * 3600 * 1000);
    const both = { heldAt, trustA: 60, trustB: 55, rejectedA: 0, rejectedB: 0 };
    expect(grantReleasable({ ...both, now: early })).toBe(false);
    expect(grantReleasable({ ...both, now: ready })).toBe(true);
    expect(grantReleasable({ ...both, now: ready, trustB: 49 })).toBe(false);
    expect(grantReleasable({ ...both, now: ready, rejectedA: 1 })).toBe(false);
    expect(() => assertTermsCurrent(null, 1)).toThrow(ForbiddenError);
    expect(() => assertTermsCurrent(0, 1)).toThrow(expect.objectContaining({ errorCode: 'terms_acceptance_required' }));
    expect(() => assertTermsCurrent(1, 1)).not.toThrow();
    const guard = new TermsGuard();
    const ctx = (player: object | undefined): ExecutionContext => ({ switchToHttp: () => ({ getRequest: () => ({ method: 'POST', player }) }) }) as ExecutionContext;
    expect(() => guard.canActivate(ctx({ wallet: 'w', termsVersion: null, privacyVersion: null }))).toThrow(expect.objectContaining({ errorCode: 'terms_acceptance_required' }));
    expect(() => guard.canActivate(ctx({ wallet: 'w' }))).toThrow(expect.objectContaining({ errorCode: 'terms_acceptance_required' }));
    expect(guard.canActivate(ctx({ wallet: 'w', termsVersion: 1, privacyVersion: 1 }))).toBe(true);
  });
});
