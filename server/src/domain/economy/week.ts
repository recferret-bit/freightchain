import { DAY_MS } from '../shared/time.js';

/** The UTC week containing `at`: Monday 00:00 → next Monday 00:00. */
export function weekBounds(at: Date): { start: Date; end: Date } {
  const day = (at.getUTCDay() + 6) % 7; // Mon = 0
  const start = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - day);
  return { start: new Date(start), end: new Date(start + 7 * DAY_MS) };
}
