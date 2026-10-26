import { levelOfTrip } from '../../domain/rides/ride-trip.js';
import { DAY_MS } from '../../domain/shared/time.js';
import { weekBounds } from '../../domain/economy/week.js';

/** Convoy activation and milestone defaults. Legacy +2/+3 grants are retired. */
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
const HOUR_MS = 3_600_000;

export type ConvoyStatus = 'pending' | 'active' | 'qualified' | 'expired';
export type PromoSkip = 'ok' | 'lifetime' | 'day' | 'week' | 'global';

export const pendingTtlMs = (hours = CONVOY_PENDING_HOURS): number => hours * HOUR_MS;
export const qualifyWindowMs = (days = CONVOY_WINDOW_DAYS): number => days * DAY_MS;

/** `A` is friends with a counted ride in the last 30 days. */
export function pendingCap(activeOrQualified: number, base = CONVOY_PENDING_BASE, perActive = CONVOY_PENDING_PER_ACTIVE, max = CONVOY_PENDING_MAX): number {
  const a = Number.isFinite(activeOrQualified) ? Math.max(0, Math.floor(activeOrQualified)) : 0;
  return Math.min(max, base + perActive * a);
}

/** MEDIUM or HARD training activates an invite; it never counts toward paid milestones. */
export function isMediumOrHardTrip(trip: string | null): boolean {
  const level = levelOfTrip(trip);
  return level === 2 || level === 3;
}

export function countedRide(i: { tier?: string; ranked?: boolean; promo?: boolean; weeklyGrant?: boolean }, trust: number, weeklyEnabled: boolean): boolean {
  if (!['1h', '4h', '8h'].includes(i.tier ?? '') || i.ranked !== true || i.promo === true) return false;
  return i.weeklyGrant !== true || (weeklyEnabled && trust >= 100);
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

export function promoDecision(c: { lifetime: boolean; day: number; week: number; globalWeek: number }, limits = { day: PROMO_PER_REFERRER_DAY, week: PROMO_PER_REFERRER_WEEK, globalWeek: PROMO_GLOBAL_WEEK }): PromoSkip {
  if (c.lifetime) return 'lifetime';
  if (c.day >= limits.day) return 'day';
  if (c.week >= limits.week) return 'week';
  if (c.globalWeek >= limits.globalWeek) return 'global';
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
  tasksComplete: boolean;
  m1Weeks?: number;
  m2Weeks?: number;
}): { m1: boolean; m2: boolean; expire: boolean } {
  const open = !windowClosed(i.qualifyExpiresAt, i.now);
  if (!open && !i.m1At) return { m1: false, m2: false, expire: true };
  const m1 = open && !i.m1At && i.tasksComplete && i.refereeWeeks >= (i.m1Weeks ?? M1_WEEKS);
  const m1Done = i.m1At !== null || m1;
  const m2 = open && m1Done && i.tasksComplete && !i.m2At && i.refereeWeeks >= (i.m2Weeks ?? M2_WEEKS);
  return { m1, m2, expire: false };
}
