import type { VerdictReason } from '../verdict/verdict.dto.js';

/** Decision 6, as the Wave 5 task states it. A flag, not a reject: rules version 7 stays. */
export const PAUSE_MAX_COUNT = 3;
export const PAUSE_MAX_SECONDS = 5 * 60;

export interface PauseTally {
  count: number;
  seconds: number;
}

/** One heartbeat. A rising edge counts. Wall seconds of a beat that arrives paused are added.
    The first paused beat includes the wall since the previous beat, which may still have been driving. */
export function notePause(wasPaused: boolean, nowPaused: boolean, wallDt: number, tally: PauseTally): PauseTally {
  const dt = wallDt > 0 ? wallDt : 0;
  return {
    count: tally.count + (nowPaused && !wasPaused ? 1 : 0),
    seconds: tally.seconds + (nowPaused ? dt : 0),
  };
}

/** Game/wall outside pauses. Below this, after SLOW_MO_MIN_WALL seconds, is a flag. */
export const SLOW_MO_RATIO = 0.9;
export const SLOW_MO_MIN_WALL = 60;

/** Empty unless a bound is past. Both are flags. */
export function pauseBoundFlags(tally: PauseTally): VerdictReason[] {
  const reasons: VerdictReason[] = [];
  if (tally.count > PAUSE_MAX_COUNT) reasons.push({ code: 'pause-limit', detail: `${tally.count} pauses, limit ${PAUSE_MAX_COUNT}`, severity: 'flag' });
  if (tally.seconds > PAUSE_MAX_SECONDS) reasons.push({ code: 'pause-time', detail: `${Math.round(tally.seconds)} s paused, limit ${PAUSE_MAX_SECONDS}`, severity: 'flag' });
  return reasons;
}

/** Shadow keeps the flag. Enforce rejects the same bounds. Off adds nothing. */
export function pauseVerdict(mode: 'off' | 'shadow' | 'enforce', tally: PauseTally): VerdictReason[] {
  if (mode === 'off') return [];
  const flags = pauseBoundFlags(tally);
  if (mode === 'shadow') return flags;
  return flags.map((reason) => ({ ...reason, severity: 'reject' as const }));
}

/** simTicks * (1000/30) against wall milliseconds outside pauses. Enforce rejects; shadow flags; off is silent. */
export function slowMotionVerdict(mode: 'off' | 'shadow' | 'enforce', simTicks: number, wallMsOutsidePauses: number): VerdictReason[] {
  if (mode === 'off' || wallMsOutsidePauses < SLOW_MO_MIN_WALL * 1000) return [];
  const simMs = simTicks * (1000 / 30);
  const ratio = simMs / wallMsOutsidePauses;
  if (ratio >= SLOW_MO_RATIO) return [];
  return [{ code: 'time-dilation', detail: `sim/wall ${ratio.toFixed(2)} outside pauses, limit ${SLOW_MO_RATIO}`, severity: mode === 'enforce' ? 'reject' : 'flag' }];
}

/** Flag only. A short ride, or a ratio at or above 0.9, adds nothing. Not a reject. */
export function timeDilationFlag(driveSeconds: number, wallSeconds: number, pauseSeconds: number): VerdictReason[] {
  const moving = wallSeconds - Math.max(0, pauseSeconds);
  if (moving < SLOW_MO_MIN_WALL) return [];
  const ratio = driveSeconds / moving;
  if (ratio >= SLOW_MO_RATIO) return [];
  return [{ code: 'time-dilation', detail: `game/wall ${ratio.toFixed(2)} outside pauses, limit ${SLOW_MO_RATIO}`, severity: 'flag' }];
}
