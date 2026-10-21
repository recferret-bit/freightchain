import { levelOfTrip } from '../../domain/rides/ride-trip.js';
import { DAY_MS } from '../../domain/shared/time.js';
import { weekBounds } from '../../domain/economy/week.js';

/** Convoy sits beside the live free-ride gift. These are the target caps, not the legacy +2/+3 grant. */
export const CONVOY_PENDING_HOURS = 72;
export const CONVOY_WINDOW_DAYS = 60;
export const CONVOY_PENDING_BASE = 5;
export const CONVOY_PENDING_PER_ACTIVE = 2;
export const CONVOY_PENDING_MAX = 100;
export const PROMO_PER_REFERRER_DAY = 3;
export const PROMO_PER_REFERRER_WEEK = 10;
export const PROMO_GLOBAL_WEEK = 500;
export const M1_WEEKS = 2;
export const M2_WEEKS = 5;
export const M1_TEN4 = 100;
export const M2_TEN4 = 50;
/** The referrer gets no free-ride gift on activation. The invitee gift is the only ride credit. */
export const REFERRER_RIDE_GIFT = 0;
export const LEADERBOARD_LIMIT = 25;
export const ANONYMOUS_DISPATCHER = 'Anonymous Dispatcher';
const HOUR_MS = 3_600_000;

export type ConvoyStatus = 'pending' | 'active' | 'qualified' | 'expired';
export type PromoSkip = 'ok' | 'lifetime' | 'day' | 'week' | 'global';

export const pendingTtlMs = (): number => CONVOY_PENDING_HOURS * HOUR_MS;
export const qualifyWindowMs = (): number => CONVOY_WINDOW_DAYS * DAY_MS;

/** `A` is active + qualified friends. Concurrent pending slots, not a lifetime cap. */
export function pendingCap(activeOrQualified: number): number {
  const a = Number.isFinite(activeOrQualified) ? Math.max(0, Math.floor(activeOrQualified)) : 0;
  return Math.min(CONVOY_PENDING_MAX, CONVOY_PENDING_BASE + CONVOY_PENDING_PER_ACTIVE * a);
}

/** MEDIUM or HARD training, including frozen trip ids. A paid 1h has no level and does not count. */
export function isMediumOrHardTrip(trip: string | null): boolean {
  const level = levelOfTrip(trip);
  return level === 2 || level === 3;
}

/** Monday of the ISO week, UTC, as YYYY-MM-DD. */
export function isoWeekKey(at: Date): string {
  return weekBounds(at).start.toISOString().slice(0, 10);
}

export function pendingExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() < now.getTime();
}

export function windowClosed(qualifyExpiresAt: Date, now: Date): boolean {
  return qualifyExpiresAt.getTime() < now.getTime();
}

export function promoDecision(c: { lifetime: boolean; day: number; week: number; globalWeek: number }): PromoSkip {
  if (c.lifetime) return 'lifetime';
  if (c.day >= PROMO_PER_REFERRER_DAY) return 'day';
  if (c.week >= PROMO_PER_REFERRER_WEEK) return 'week';
  if (c.globalWeek >= PROMO_GLOBAL_WEEK) return 'global';
  return 'ok';
}

/** Counted rides whose instant is inside the activation window, one per ISO week. */
export function distinctWeeks(rides: readonly { at: Date; counted: boolean }[], from: Date, until: Date): number {
  const keys = new Set<string>();
  for (const ride of rides) {
    if (!ride.counted) continue;
    const t = ride.at.getTime();
    if (t < from.getTime() || t > until.getTime()) continue;
    keys.add(isoWeekKey(ride.at));
  }
  return keys.size;
}

export function milestoneDecision(i: {
  m1At: Date | null;
  m2At: Date | null;
  qualifyExpiresAt: Date;
  now: Date;
  refereeWeeks: number;
  referrerCounted: boolean;
}): { m1: boolean; m2: boolean; expire: boolean } {
  const open = !windowClosed(i.qualifyExpiresAt, i.now);
  if (!open && !i.m1At) return { m1: false, m2: false, expire: true };
  const m1 = open && !i.m1At && i.referrerCounted && i.refereeWeeks >= M1_WEEKS;
  const m1Done = i.m1At !== null || m1;
  const m2 = open && m1Done && !i.m2At && i.refereeWeeks >= M2_WEEKS;
  return { m1, m2, expire: false };
}
