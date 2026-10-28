import type { GameSettings } from './game-settings.js';
export const PRESEASON_PROMO_CODE = 'SYSTEM-PRESEASON-2026-11';

/** Zero dates fail closed; the owner must explicitly enable a coherent UTC window. */
export function eventWindow(settings: GameSettings): { start: Date; lastStart: Date; end: Date } | null {
  const { eventModeEnabled: enabled, eventWeekStartUtc: start, eventLastStartUtc: last, eventWeekEndUtc: end } = settings;
  if (enabled !== 1 || start <= 0 || last <= start || end - last < 4500) return null;
  return { start: new Date(start * 1000), lastStart: new Date(last * 1000), end: new Date(end * 1000) };
}

export type EventPhase = 'pending' | 'preliminary' | 'final';

/** The review/appeals clock. Fails closed: a zero date, or an order other than week end < review end < appeals end, is no schedule at all. */
export function eventReviewSchedule(settings: GameSettings): { reviewEnd: Date; appealsEnd: Date } | null {
  const { eventWeekEndUtc: end, eventReviewEndUtc: review, eventAppealsEndUtc: appeals } = settings;
  if (end <= 0 || review <= end || appeals <= review) return null;
  return { reviewEnd: new Date(review * 1000), appealsEnd: new Date(appeals * 1000) };
}
