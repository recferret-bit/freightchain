/** No safe stop before the last 3 minutes. Not an answer outcome, and not counted. */
export function noSafeStopStatus(): 'cancelled' {
  return 'cancelled';
}

/** The event was revealed (the driver had the bay) and the window elapsed with no answer. */
export function bayMissStatus(): 'missed' {
  return 'missed';
}

export type MiniGameStatus = 'armed' | 'revealed' | 'answered' | 'missed' | 'expired' | 'invalid' | 'cancelled';

const CLOSED: readonly MiniGameStatus[] = ['answered', 'missed', 'expired', 'invalid', 'cancelled'];

export const isClosedStatus = (status: MiniGameStatus): boolean => CLOSED.includes(status);

/** Heartbeat bookkeeping. A late POST answer is `expired` (410) instead — see the answer handler. */
export function heartbeatStatus(status: MiniGameStatus, driveSeconds: number, minSeconds: number, revealedAtMs: number | null, windowMs: number, nowMs: number, timeScale = 1): MiniGameStatus {
  const endPadS = 180 / (timeScale > 1 ? timeScale : 1);
  if (status === 'armed' && driveSeconds >= minSeconds - endPadS) return noSafeStopStatus();
  if (status === 'revealed' && revealedAtMs !== null && nowMs > revealedAtMs + windowMs) return bayMissStatus();
  return status;
}
