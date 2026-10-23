import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { heartbeatStatus } from '../../../backend/server/src/domain/minigames/close.js';
import { minigamesEligible } from '../../../backend/server/src/domain/minigames/eligibility.js';
import { ACCEPTED_KINDS, CODE_PENALTY_S, issuedKinds } from '../../../backend/server/src/domain/minigames/kinds.js';
import { mgCommitHex, mgSaltBytes, toHex } from '../../../backend/server/src/domain/minigames/mac.js';
import { mgClock, scheduleSlots, type ScheduledSlot } from '../../../backend/server/src/domain/minigames/schedule.js';
import { scoreAttempt } from '../../../backend/server/src/domain/minigames/score.js';
import { minigameVerdictDelta } from '../../../backend/server/src/domain/minigames/verdict.js';

const SECRET = 'freightchain-mg-secret-32bytes-min';
const mac = {
  hmacSha256: (key: Uint8Array | string, message: Uint8Array | string) => createHmac('sha256', key).update(message).digest(),
  sha256: (data: Uint8Array | string) => createHash('sha256').update(data).digest(),
};

const HOUR_S = 3600;
const KNOWN = ['phone-sms', 'seed-words', 'buy-shitcoin', 'address-check', 'sign-or-reject', 'fuel-rugpull', 'gas-priority'] as const;

function cycle(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

function assertHour(slots: ScheduledSlot[]): void {
  const clock = mgClock(1);
  expect(clock).toEqual({ armAfterS: 300, endPadS: 180, gapS: 480 });
  expect(slots.length === 2 || slots.length === 3 || slots.length === 4).toBe(true);
  expect(slots.every((slot) => slot.kind === 'phone-sms')).toBe(true);
  expect(slots.every((slot) => slot.slotS === null)).toBe(true);
  expect(slots[0]!.armAtS).toBeGreaterThanOrEqual(clock.armAfterS);
  expect(slots.at(-1)!.armAtS).toBeLessThan(HOUR_S - clock.endPadS);
  for (let i = 1; i < slots.length; i++) {
    expect(slots[i]!.armAtS - slots[i - 1]!.armAtS).toBeGreaterThanOrEqual(clock.gapS);
  }
}

describe('minigame schedule', () => {
  it('MGM-T-01 free, tutorial, and assist rides are not eligible', () => {
    expect(minigamesEligible({ tier: 'free', tutorial: false, assist: false })).toBe(false);
    expect(minigamesEligible({ tier: '1h', tutorial: true, assist: false })).toBe(false);
    expect(minigamesEligible({ tier: '1h', tutorial: false, assist: true })).toBe(false);
    expect(minigamesEligible({ tier: 'free', tutorial: true, assist: true })).toBe(false);
    expect(minigamesEligible({ tier: '1h', tutorial: false, assist: false })).toBe(true);
  });

  it('MGM-T-01 issuedKinds drops every kind but phone-sms, including an empty list', () => {
    expect(issuedKinds([])).toEqual([]);
    expect(issuedKinds(['seed-words'])).toEqual([]);
    expect(issuedKinds(['buy-shitcoin', 'address-check', 'sign-or-reject', 'fuel-rugpull', 'gas-priority'])).toEqual([]);
    expect(scheduleSlots(() => 0.5, HOUR_S, [], 1)).toEqual([]);
    expect(scheduleSlots(() => 0.5, HOUR_S, ['seed-words', 'buy-shitcoin'], 1)).toEqual([]);
    expect(scheduleSlots(() => 0.9, HOUR_S, ['address-check', 'sign-or-reject', 'fuel-rugpull', 'gas-priority'], 1)).toEqual([]);
  });

  it('MGM-T-02 a 1h shift arms 2, 3, or 4 phone-sms slots, and a short shift arms none', () => {
    const counts = new Set<number>();
    const byRoll: [() => number, number][] = [
      [() => 0.1, 2],
      [() => 0.5, 3],
      [() => 0.9, 4],
      [cycle([0.8, 0.4, 0.2, 0.6, 0.3, 0.7]), 4],
    ];
    for (const [rng, n] of byRoll) {
      const slots = scheduleSlots(rng, HOUR_S, ['phone-sms'], 1);
      expect(slots).toHaveLength(n);
      assertHour(slots);
      counts.add(slots.length);
    }
    expect(counts.size).toBeGreaterThan(1);
    expect([...counts].sort()).toEqual([2, 3, 4]);
    expect(scheduleSlots(() => 0.5, 100, ['phone-sms'], 1)).toEqual([]);
  });

  it('MGM-T-03 the same ride and wallet recompute the same commit, and another wallet changes the salt', () => {
    expect(SECRET.length).toBeGreaterThanOrEqual(32);
    const salt = mgSaltBytes(mac, SECRET, 'mg:v1', 'ride-1', 'wallet-a');
    const commit = mgCommitHex(mac, salt);
    expect(mgCommitHex(mac, mgSaltBytes(mac, SECRET, 'mg:v1', 'ride-1', 'wallet-a'))).toBe(commit);
    const other = mgSaltBytes(mac, SECRET, 'mg:v1', 'ride-1', 'wallet-b');
    expect(toHex(other)).not.toBe(toHex(salt));
    expect(mgCommitHex(mac, other)).not.toBe(commit);
    expect(createHash('sha256').update(salt).digest('hex')).toBe(commit);
    expect(toHex(salt)).not.toBe(commit);
  });

  it('MGM-T-04 only phone-sms is issued, and every scheduled slot is phone-sms', () => {
    expect(ACCEPTED_KINDS).toEqual(['phone-sms']);
    expect(issuedKinds(KNOWN)).toEqual(['phone-sms']);
    const slots = scheduleSlots(() => 0.5, HOUR_S, KNOWN, 1);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => slot.kind === 'phone-sms')).toBe(true);
  });

  it('MGM-T-05 an armed event inside the end pad is cancelled with no score, and only enforce flags an unsafe open', () => {
    const minSeconds = HOUR_S;
    const status = heartbeatStatus('armed', minSeconds - 10, minSeconds, null, 30_000, 0, 1);
    expect(status).toBe('cancelled');
    let scoreCalls = 0;
    const penaltyS = status === 'cancelled' ? 0 : (scoreCalls += 1, scoreAttempt('code', 3, false).penaltyS);
    expect(scoreCalls).toBe(0);
    expect(penaltyS).toBe(0);
    expect(penaltyS).not.toBe(CODE_PENALTY_S);
    expect(minigameVerdictDelta({ mode: 'off', events: [{ id: 'e', clientSafe: false }] })).toEqual([]);
    expect(minigameVerdictDelta({ mode: 'shadow', events: [{ id: 'e', clientSafe: false }] })).toEqual([]);
    const flagged = minigameVerdictDelta({ mode: 'enforce', events: [{ id: 'e', clientSafe: false }] });
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ code: 'mg-unsafe-open', severity: 'flag' });
    expect(flagged.some((reason) => reason.severity === 'reject')).toBe(false);
    expect(flagged.every((reason) => reason.severity === 'flag')).toBe(true);
  });
});
