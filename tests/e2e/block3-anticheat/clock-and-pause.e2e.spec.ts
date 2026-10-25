import { unitContext } from '../../../backend/server/test/support/unit-context.js';
import { describe, expect, it } from 'vitest';
import { REPLAY_SIM_HZ } from '../../../frontend/client/shared/physics.js';
import { SAMPLE_HZ } from '../../../backend/server/src/domain/telemetry/telemetry-rules.js';
import { notePause, pauseVerdict, slowMotionVerdict } from '../../../backend/server/src/domain/rides/pause-bounds.js';
import { GRANT_HOLD_MS, TRUST_INITIAL, applyTrust, grantReleasable, type HoldParties } from '../../../backend/server/src/domain/anticheat/trust-score.js';

const heldAt = new Date('2026-01-01T00:00:00.000Z');
const insideHold = new Date(heldAt.getTime() + GRANT_HOLD_MS - 1);
const afterHold = new Date(heldAt.getTime() + GRANT_HOLD_MS);

function parties(over: Partial<HoldParties> = {}): HoldParties {
  return { now: afterHold, heldAt, trustA: 60, trustB: 60, rejectedA: 0, rejectedB: 0, ...over };
}

describe('clock and pause', () => {
  it('AC-F1 off mode adds nothing for 4 pauses', () => {
    expect(pauseVerdict('off', { count: 4, seconds: 301 })).toEqual([]);
  });

  it('AC-F2 shadow flags pause-limit at count 4 and does not reject', () => {
    const reasons = pauseVerdict('shadow', { count: 4, seconds: 0 });
    expect(reasons.map((reason) => reason.code)).toContain('pause-limit');
    expect(reasons.find((reason) => reason.code === 'pause-limit')?.severity).toBe('flag');
    expect(reasons.some((reason) => reason.severity === 'reject')).toBe(false);
  });

  it('AC-F3 shadow flags pause-time at 301 seconds', () => {
    const reasons = pauseVerdict('shadow', { count: 0, seconds: 301 });
    expect(reasons.map((reason) => reason.code)).toContain('pause-time');
    expect(reasons.find((reason) => reason.code === 'pause-time')?.severity).toBe('flag');
  });

  it('AC-F4 enforce rejects pause-limit at count 4', () => {
    const reasons = pauseVerdict('enforce', { count: 4, seconds: 0 });
    expect(reasons.map((reason) => reason.code)).toEqual(['pause-limit']);
    expect(reasons[0]?.severity).toBe('reject');
  });

  it('AC-F5 enforce rejects pause-time at 301 seconds', () => {
    const reasons = pauseVerdict('enforce', { count: 0, seconds: 301 });
    expect(reasons.map((reason) => reason.code)).toEqual(['pause-time']);
    expect(reasons[0]?.severity).toBe('reject');
  });

  it('AC-F6 enforce slow-mo rejects time-dilation when sim is far below 0.9 of wall', () => {
    const wallMs = 120_000;
    const simTicks = 30;
    const ratio = (simTicks * (1000 / 30)) / wallMs;
    expect(ratio).toBeLessThan(0.9);
    const reasons = slowMotionVerdict('enforce', simTicks, wallMs);
    expect(reasons.map((reason) => reason.code)).toEqual(['time-dilation']);
    expect(reasons[0]?.severity).toBe('reject');
  });

  it('AC-F7 a sim/wall ratio at or above 0.9 adds nothing', () => {
    const wallMs = 120_000;
    const simTicks = 3240;
    const ratio = (simTicks * (1000 / 30)) / wallMs;
    expect(ratio).toBeGreaterThanOrEqual(0.9);
    expect(slowMotionVerdict('enforce', simTicks, wallMs)).toEqual([]);
  });

  it('AC-F8 shadow slow-mo flags time-dilation and does not reject', () => {
    const reasons = slowMotionVerdict('shadow', 30, 120_000);
    expect(reasons.map((reason) => reason.code)).toEqual(['time-dilation']);
    expect(reasons[0]?.severity).toBe('flag');
    expect(reasons.some((reason) => reason.severity === 'reject')).toBe(false);
  });

  it('AC-F9 off slow-mo is silent', () => {
    expect(slowMotionVerdict('off', 30, 120_000)).toEqual([]);
  });

  it('AC-F10 notePause counts a rising edge once', () => {
    const rising = notePause(false, true, 2, { count: 0, seconds: 0 });
    expect(rising.count).toBe(1);
    const held = notePause(true, true, 2, rising);
    expect(held.count).toBe(1);
    expect(held.seconds).toBe(4);
  });

  it('AC-F11 REPLAY_SIM_HZ and SAMPLE_HZ stay 10', () => {
    expect(REPLAY_SIM_HZ).toBe(10);
    expect(SAMPLE_HZ).toBe(10);
  });

  it('AC-R1 a grant inside 48h is not releasable', () => {
    expect(GRANT_HOLD_MS).toBe(48 * 60 * 60 * 1000);
    expect(grantReleasable(parties({ now: insideHold }))).toBe(false);
  });

  it('AC-R2 a grant after 48h with trust 60/60 and no rejects is releasable', () => {
    expect(grantReleasable(parties())).toBe(true);
  });

  it('AC-R3 trust 49 blocks the grant after the hold', () => {
    expect(grantReleasable(parties({ trustA: 49 }))).toBe(false);
  });

  it('AC-R4 one rejected ride blocks the grant', () => {
    expect(grantReleasable(parties({ rejectedA: 1 }))).toBe(false);
  });

  it('AC-R5 repeated session touches preserve trust below the payout threshold', async () => {
    const ctx = unitContext();
    const player = await ctx.player('returning');
    player.setTrustScore(49);
    await ctx.players.save(player);
    for (let i = 0; i < 5; i++) expect((await ctx.sessions.touch('returning')).trustScore).toBe(49);
  });

  it('AC-R6 applyTrust rejected from 60 is 45', () => {
    expect(applyTrust(60, 'rejected')).toBe(45);
  });

  it('AC-R7 applyTrust reads a score and an event name, not a fingerprint', () => {
    expect(applyTrust.length).toBe(2);
    expect(applyTrust(60, 'verified')).toBe(65);
  });

  it('AC-R8 TRUST_INITIAL is 60', () => {
    expect(TRUST_INITIAL).toBe(60);
  });
});
