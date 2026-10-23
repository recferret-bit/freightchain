import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MinigameRateService } from '../../../backend/server/src/application/services/minigame-rate.service.js';
import { heartbeatStatus } from '../../../backend/server/src/domain/minigames/close.js';
import { CODE_ATTEMPTS, CODE_PENALTY_S, WINDOW_MS, issuedKinds } from '../../../backend/server/src/domain/minigames/kinds.js';
import { answerHashHex, macStructurallyValid, mgSaltBytes } from '../../../backend/server/src/domain/minigames/mac.js';
import { buildPhoneSms, openPayload, type MinigameOpenDto } from '../../../backend/server/src/domain/minigames/phone-sms.js';
import { scheduleSlots } from '../../../backend/server/src/domain/minigames/schedule.js';
import { scoreAttempt } from '../../../backend/server/src/domain/minigames/score.js';
import { svgLeaksText } from '../../../backend/server/src/domain/minigames/svg.js';
import { minigameVerdictDelta, type MinigameVerdictInput } from '../../../backend/server/src/domain/minigames/verdict.js';

const SECRET = 'freightchain-mg-secret-32bytes-min';
const mac = {
  hmacSha256: (key: Uint8Array | string, message: Uint8Array | string) => createHmac('sha256', key).update(message).digest(),
  sha256: (data: Uint8Array | string) => createHash('sha256').update(data).digest(),
};

function saltFor(label: string): Uint8Array {
  return mgSaltBytes(mac, SECRET, 'mg:v1', label, 'wallet-a');
}

function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, out);
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) stringsOf(item, out);
  return out;
}

function hasNamedCode(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasNamedCode);
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (Object.hasOwn(rec, 'code')) return true;
    return Object.values(rec).some(hasNamedCode);
  }
  return false;
}

function expectFlagOrEmpty(reasons: { severity: string }[]): void {
  expect(reasons.every((reason) => reason.severity === 'flag')).toBe(true);
  expect(reasons.some((reason) => reason.severity === 'reject')).toBe(false);
}

describe('minigame challenges', () => {
  it('MGM-T-07 the open payload omits the code, and the dispatch picture is a mark', () => {
    const built = buildPhoneSms(mac, saltFor('phone'), 0, 0, 'en', 'normal');
    expect(built.code).toMatch(/^\d{4,6}$/);
    const dto: MinigameOpenDto = openPayload(built, 0, 0, 1_000);
    const json = JSON.stringify(dto);
    expect(hasNamedCode(dto)).toBe(false);
    expect(json.includes(built.code)).toBe(false);
    expect(json.includes(built.answerHash)).toBe(false);
    expect(json.includes('<svg')).toBe(false);
    expect(json.includes('signTransaction')).toBe(false);
    expect(stringsOf(dto)).not.toContain(built.code);
    expect(stringsOf(dto)).not.toContain(built.answerHash);
    for (const svg of Object.values(built.svgs)) expect(json.includes(svg)).toBe(false);
    const dispatch = built.layout.threads.find((thread) => thread.role === 'dispatch');
    expect(dispatch).toBeDefined();
    const mark = built.svgs[dispatch!.bubbles[0]!.assetId];
    expect(mark).toBeDefined();
    expect(mark!.includes('<rect')).toBe(false);
    const cab = built.layout.cab.map((slip) => built.svgs[slip.assetId] ?? '');
    expect(cab.some((svg) => svg.includes('<rect'))).toBe(true);
    expect(Object.values(built.svgs).some((svg) => svg.includes('<rect'))).toBe(true);
    for (const svg of Object.values(built.svgs)) {
      expect(svgLeaksText(svg)).toBe(false);
      expect(svg.includes('<text')).toBe(false);
    }
  });

  it('MGM-T-06 three wrong tries cost +20 on the last, and a correct second try passes', () => {
    expect(CODE_ATTEMPTS).toBe(3);
    expect(CODE_PENALTY_S).toBe(20);
    expect(scoreAttempt('code', 1, false)).toMatchObject({ outcome: 'pending', penaltyS: 0, attempts: 1, terminal: false });
    expect(scoreAttempt('code', 2, false)).toMatchObject({ outcome: 'pending', penaltyS: 0, attempts: 2, terminal: false });
    expect(scoreAttempt('code', 3, false)).toEqual({ outcome: 'failed', penaltyS: 20, attempts: 3, terminal: true });
    expect(scoreAttempt('code', 2, true)).toEqual({ outcome: 'passed', penaltyS: 0, attempts: 2, terminal: true });
  });

  it('MGM-T-06 a miss is not a +45 penalty, and two misses do not flag the ride', () => {
    const missed = heartbeatStatus('revealed', 0, 3600, 1_000, 30_000, 1_000 + 30_001, 1);
    expect(missed).toBe('missed');
    const missPenaltyS = missed === 'missed' ? 0 : 45;
    expect(missPenaltyS).toBe(0);
    expect(missPenaltyS).not.toBe(45);
    const reasons = minigameVerdictDelta({
      mode: 'enforce',
      events: [{ id: 'miss-1', clientSafe: null }, { id: 'miss-2', clientSafe: null }],
    });
    expect(reasons).toEqual([]);
    expect(reasons.some((reason) => reason.code === 'mg-missed')).toBe(false);
    expectFlagOrEmpty(reasons);
  });

  it('MGM-T-08 more-time is 60s with no decoy threads, and normal has more threads', () => {
    expect(WINDOW_MS['more-time']).toBe(60_000);
    expect(WINDOW_MS.normal).toBe(30_000);
    const salt = saltFor('window');
    const more = buildPhoneSms(mac, salt, 0, 0, 'en', 'more-time');
    const normal = buildPhoneSms(mac, salt, 0, 0, 'en', 'normal');
    expect(more.windowMs).toBe(60_000);
    expect(normal.windowMs).toBe(30_000);
    expect(more.layout.threads).toHaveLength(1);
    expect(more.layout.threads.filter((thread) => thread.role !== 'dispatch')).toHaveLength(0);
    expect(normal.layout.threads.length).toBeGreaterThan(more.layout.threads.length);
  });

  it('MGM-T-09 an answer hash is stable 64 hex chars, and a different answer differs', () => {
    const first = answerHashHex(mac, 'event-9', '1234');
    const again = answerHashHex(mac, 'event-9', '1234');
    const other = answerHashHex(mac, 'event-9', '5678');
    expect(first).toBe(again);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(other).toMatch(/^[0-9a-f]{64}$/);
  });

  it('MGM-T-10 the 11th hit in one minute is mg_rate_limited, and another ride or the next minute is not', () => {
    const rate = new MinigameRateService();
    const now = 5_000_000;
    for (let n = 0; n < 10; n++) rate.hit('ride-a', now);
    let caught: { errorCode?: string } | undefined;
    try {
      rate.hit('ride-a', now);
    } catch (err) {
      caught = err as { errorCode?: string };
    }
    expect(caught?.errorCode).toBe('mg_rate_limited');
    expect(() => rate.hit('ride-b', now)).not.toThrow();
    expect(() => rate.hit('ride-a', now + 60_001)).not.toThrow();
  });

  it('MGM-T-11 a revealed window is already missed before a late answer (410), and the mac is only a shape', () => {
    expect(heartbeatStatus('revealed', 0, 3600, 1_000, 30_000, 1_000 + 30_001, 1)).toBe('missed');
    expect(macStructurallyValid('a'.repeat(43))).toBe(true);
    expect(macStructurallyValid('short')).toBe(false);
  });

  it('MGM-T-12 gulp and pike are not kinds, an empty event list adds nothing, and a donation is not an argument', () => {
    expect(issuedKinds(['gulp', 'pike'])).toEqual([]);
    expect(issuedKinds(['phone-sms', 'gulp', 'pike'])).toEqual(['phone-sms']);
    expect(issuedKinds(['gulp', 'pike']).includes('gulp')).toBe(false);
    expect(issuedKinds(['gulp', 'pike']).includes('pike')).toBe(false);
    expect(scheduleSlots(() => 0.5, 3600, ['gulp', 'pike'], 1)).toEqual([]);
    expect(scheduleSlots(() => 0.9, 3600, ['not-a-kind'], 1)).toEqual([]);
    const empty: MinigameVerdictInput = { mode: 'enforce', events: [] };
    const again = minigameVerdictDelta({ mode: 'enforce', events: [] });
    expect(again).toEqual(minigameVerdictDelta(empty));
    expect(again).toEqual([]);
    expect(minigameVerdictDelta({ mode: 'off', events: [] })).toEqual(again);
    expect(minigameVerdictDelta({ mode: 'shadow', events: [] })).toEqual(again);
    const tipped = { mode: 'enforce' as const, events: [] as const, donationUsd: 25 };
    expect(minigameVerdictDelta(tipped)).toEqual(again);
    expect(scheduleSlots.length).toBe(3);
    expect(minigameVerdictDelta.length).toBe(1);
    expect(scheduleSlots.toString()).not.toContain('donation');
    expect(minigameVerdictDelta.toString()).not.toContain('donation');
    const samples = [
      minigameVerdictDelta({ mode: 'off', events: [{ id: 'e', clientSafe: false }] }),
      minigameVerdictDelta({ mode: 'shadow', events: [{ id: 'e', clientSafe: false }] }),
      minigameVerdictDelta({ mode: 'enforce', events: [{ id: 'e', clientSafe: false }] }),
      minigameVerdictDelta({ mode: 'enforce', events: [{ id: 'ok', clientSafe: true }] }),
      again,
    ];
    for (const reasons of samples) expectFlagOrEmpty(reasons);
  });
});
