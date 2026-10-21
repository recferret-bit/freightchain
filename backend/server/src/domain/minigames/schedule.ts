import { issuedKinds } from './kinds.js';

export interface ScheduledSlot {
  ordinal: number;
  kind: 'phone-sms';
  /** drive-seconds */
  armAtS: number;
  armedAtMs: number;
  bayDeadlineMs: number;
  /** Pocket geometry is not built. Clearance is `shiftPastForbidden`, not a road read. */
  slotS: null;
  trigger: 'stop';
}

/** 5 min before the first arm, 3 min clear of the finish, 8 min between arms. A demo scale shrinks all three with the shift. */
export function mgClock(timeScale: number): { armAfterS: number; endPadS: number; gapS: number } {
  const scale = timeScale > 1 ? timeScale : 1;
  return { armAfterS: 300 / scale, endPadS: 180 / scale, gapS: 480 / scale };
}

/**
 * Nominal length is `minSeconds` — create-ride already divides the tier length by timeScale.
 * Arm inside [armAfter, minSeconds − endPad]. n ∈ {2, 3, 4} with weights 0.25 / 0.5 / 0.25.
 * Pass `timeScale` so a 60× demo hour still gets 2–4 events. A shift too short for two arms gets nothing.
 */
export function scheduleSlots(rnd: () => number, minSeconds: number, requested: readonly string[], timeScale = 1): ScheduledSlot[] {
  if (!issuedKinds(requested).includes('phone-sms')) return [];
  const { armAfterS, endPadS, gapS } = mgClock(timeScale);
  const lo = armAfterS;
  const hi = minSeconds - endPadS;
  const span = hi - lo;
  if (!(span >= gapS)) return [];
  const roll = rnd();
  let n = roll < 0.25 ? 2 : roll < 0.75 ? 3 : 4;
  while (n > 2 && (n - 1) * gapS > span) n -= 1;
  if ((n - 1) * gapS > span) return [];
  const slack = span - (n - 1) * gapS;
  const weights = Array.from({ length: n + 1 }, () => rnd() + 1e-9);
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = lo;
  const bayDeadlineMs = Math.round(hi * 1000);
  const out: ScheduledSlot[] = [];
  for (let i = 0; i < n; i++) {
    t += (weights[i]! / sum) * slack;
    const armAtS = Math.round(t * 1000) / 1000;
    out.push({ ordinal: i, kind: 'phone-sms', armAtS, armedAtMs: Math.round(armAtS * 1000), bayDeadlineMs, slotS: null, trigger: 'stop' });
    t += gapS;
  }
  return out;
}
