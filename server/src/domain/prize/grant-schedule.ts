import { DAY_MS } from '../shared/time.js';
import { SEASON_EPOCH } from './prize-rules.js';

/** Monday 00:00 UTC. An interval of 7 days therefore starts on a prize-week Monday. */
const ANCHOR_MS = Date.parse(`${SEASON_EPOCH}T00:00:00.000Z`);

/**
 * The UTC-day slot of `intervalDays` that contains `at`.
 * Slots are calendar-aligned, not counted from the wallet's last visit.
 */
export function grantSlot(at: Date, intervalDays: number): { start: Date; end: Date } {
  const days = Math.max(1, Math.floor(intervalDays));
  const index = Math.floor((Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) - ANCHOR_MS) / DAY_MS);
  const slot = Math.floor(index / days);
  const start = new Date(ANCHOR_MS + slot * days * DAY_MS);
  return { start, end: new Date(start.getTime() + days * DAY_MS) };
}
