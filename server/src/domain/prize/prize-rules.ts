import { DAY_MS } from '../shared/time.js';

/* Weekly skill contest (docs/prize/SPEC.md). Variant B: not an equal-chance free method of entry.
   The on-chain ticket vault is a different pot. TEN4 is never a prize. Draft geo lists need legal review. */

export const PRIZE_CURRENCY = 'USDC' as const;
export const TOKEN_IS_PRIZE = false;

export const PRIZE_TIERS = ['1h', '4h', '8h'] as const;
export type PrizeTier = (typeof PRIZE_TIERS)[number];

/** Ranked play is Monday 00:00 UTC through Sunday 12:00 UTC. Not the legacy round. */
export const PRIZE_WEEK_OPEN_HOUR_UTC = 0;
const HOUR_MS = 3_600_000;
/** Sunday 12:00 UTC, measured from Monday 00:00. */
export const RANKED_CLOSE_MS = (6 * 24 + 12) * HOUR_MS;
/** Verification runs Sunday 12:00 UTC through Monday 12:00 UTC. */
export const VERIFY_END_MS = (7 * 24 + 12) * HOUR_MS;
/** Appeals run until Tuesday 12:00 UTC. Payouts begin then and finish on Tuesday. */
export const APPEALS_END_MS = (8 * 24 + 12) * HOUR_MS;
export const PAYOUT_END_MS = 9 * 24 * HOUR_MS;

export const SEASON_WEEKS = 8;
/** First Monday of season 1. Week 8 of each season is the live final. */
export const SEASON_EPOCH = '2026-10-12';
export const LIVE_FINAL_WEEK = 8;

/** First 2 declared free starts, 1 declared promo start, and first 5 declared paid starts. */
export const FREE_RANKED_STARTS = 2;
export const PROMO_RANKED_STARTS = 1;
export const PAID_RANKED_STARTS = 5;

export const MIN_BOARD_PARTICIPANTS = 10;
export const TOP_PLACES = 10;
export const TOP_PERCENT_OVER = 100;
export const SEASON_QUALIFIERS = 8;
/** A missed season week. Worse than any real place, so skipping a week cannot improve the sum. */
export const MISSED_WEEK_PLACE = 1000;

export const BASE_STEPS_CENTS = [30_000, 75_000, 150_000, 300_000] as const;
export const BONUS_OF_REVENUE_BPS = 4_000;
export const BONUS_CAP_CENTS = 250_000;
export const SEASON_RESERVE_BPS = 1_000;
export const REVENUE_STEP_MULTIPLE = 4;
export const STEP_STREAK_WEEKS = 4;

/** Of the week's distributable cents, after the season slice of the bonus. */
export const BOARD_BPS: Record<PrizeTier, number> = { '1h': 2_500, '4h': 3_000, '8h': 4_500 };

/** Of one board. Ranks 6–10 are 3% each so the ten shares are 80% and the finisher pool is the other 20%. */
export const PLACE_BPS = [2_500, 1_500, 1_000, 750, 750, 300, 300, 300, 300, 300] as const;
export const PLACE_POOL_BPS = 8_000;
export const FINISHER_POOL_BPS = 2_000;
export const MIN_PAYOUT_CENTS = 500;

/** Comprehensive-sanctions draft. Not a legal list. Regions that are not a country code are not in here. */
export const SANCTIONED_COUNTRIES = ['CU', 'IR', 'KP', 'SY'] as const;

/** Prize eligibility off by default. Play of an unranked ride is a separate gate. */
export const PRIZE_BLOCKED_COUNTRIES = [
  'GB',
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
] as const;

/** USPS codes. `DE` here is Delaware; Germany is the country `DE` in `PRIZE_BLOCKED_COUNTRIES`. */
export const BLOCKED_US_STATES = ['SC', 'AZ', 'LA', 'AR', 'DE', 'MT', 'TN'] as const;

export interface PrizeGeoRules {
  sanctionedCountries: readonly string[];
  prizeBlockedCountries: readonly string[];
  blockedUsStates: readonly string[];
}

export const DEFAULT_GEO: PrizeGeoRules = {
  sanctionedCountries: SANCTIONED_COUNTRIES,
  prizeBlockedCountries: PRIZE_BLOCKED_COUNTRIES,
  blockedUsStates: BLOCKED_US_STATES,
};

export interface PrizeProfile {
  age18: boolean;
  /** ISO 3166-1 alpha-2. Null is unknown and cannot enter. */
  country: string | null;
  /** USPS state when `country` is US. Ignored otherwise. */
  usState: string | null;
  kyc: boolean;
}

export interface PrizeAccess {
  ranked: boolean;
  payout: boolean;
  reasons: string[];
}

const code = (v: string | null): string => (v ?? '').trim().toUpperCase();
const has = (list: readonly string[], v: string): boolean => list.includes(v);

/** Ranked entry needs 18+ and a country that is not sanctioned, not UK/EU, and not a blocked US state.
    A payout also needs KYC. Unknown country fails closed. */
export function prizeAccess(profile: PrizeProfile, geo: PrizeGeoRules = DEFAULT_GEO): PrizeAccess {
  const reasons: string[] = [];
  if (!profile.age18) reasons.push('age');
  const country = code(profile.country);
  if (!country) reasons.push('country');
  else if (has(geo.sanctionedCountries, country)) reasons.push('sanctioned');
  else if (has(geo.prizeBlockedCountries, country)) reasons.push('region');
  else if (country === 'US' && has(geo.blockedUsStates, code(profile.usState))) reasons.push('us-state');
  const ranked = reasons.length === 0;
  if (ranked && !profile.kyc) reasons.push('kyc');
  return { ranked, payout: ranked && profile.kyc, reasons };
}

/** Road-affecting spectator events stay off on a ranked run. Chat and cosmetics are not this function. */
export function rankedRoadEffects(ranked: boolean): { obstacles: boolean; weather: boolean; dayNight: boolean } {
  return ranked ? { obstacles: false, weather: false, dayNight: false } : { obstacles: true, weather: true, dayNight: true };
}

/** True when this spectator action would change the road. Chat is never blocked. A tip (`game: false`) is not blocked. */
export function rankedSpectatorBlocked(
  ranked: boolean,
  input: { kind: 'message' } | { kind: 'honk-time' } | { kind: 'honk-weather' } | { kind: 'donation'; game: boolean; obstacle: boolean; effect: string },
): boolean {
  if (!ranked || input.kind === 'message') return false;
  const allow = rankedRoadEffects(true);
  if (input.kind === 'honk-time') return !allow.dayNight;
  if (input.kind === 'honk-weather') return !allow.weather;
  if (!input.game) return false;
  if (input.obstacle) return !allow.obstacles;
  if (input.effect === 'night' || input.effect === 'day') return !allow.dayNight;
  return true;
}

export interface PrizeWeek {
  id: string;
  /** Monday 00:00 UTC. Ranked starts are allowed from here. */
  start: Date;
  /** Sunday 12:00 UTC. A ranked start must be able to finish by this instant. */
  end: Date;
  /** Monday 12:00 UTC. Verification of this week. Overlaps the next ranked window. */
  verifyEnd: Date;
  /** Tuesday 12:00 UTC. Appeals close and payouts begin. */
  appealsEnd: Date;
  payoutAt: Date;
  /** Wednesday 00:00 UTC. The Tuesday payout day is over. */
  payoutEnds: Date;
}

export type PrizePhase = 'ranked' | 'verification' | 'appeals' | 'payout';

/** The ranked week that contains `at`. The week changes at Monday 00:00 UTC, so Sunday afternoon is still the week that opened on Monday. */
export function prizeWeek(at: Date): PrizeWeek {
  const day = (at.getUTCDay() + 6) % 7;
  const startMs = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - day, PRIZE_WEEK_OPEN_HOUR_UTC);
  const start = new Date(startMs);
  const appealsEnd = new Date(startMs + APPEALS_END_MS);
  return {
    id: start.toISOString().slice(0, 10),
    start,
    end: new Date(startMs + RANKED_CLOSE_MS),
    verifyEnd: new Date(startMs + VERIFY_END_MS),
    appealsEnd,
    payoutAt: appealsEnd,
    payoutEnds: new Date(startMs + PAYOUT_END_MS),
  };
}

/** Phase of the week `prizeWeek(at)` returns. The previous week's verification and appeals still run after the next Monday 00:00 (`openSettlement`). */
export function prizePhase(at: Date): PrizePhase {
  const week = prizeWeek(at);
  const t = at.getTime();
  if (t < week.end.getTime()) return 'ranked';
  if (t < week.verifyEnd.getTime()) return 'verification';
  if (t < week.appealsEnd.getTime()) return 'appeals';
  return 'payout';
}

/** The previous week while its verification, appeals, or Tuesday payout is still open. Null once that Tuesday has ended. */
export function openSettlement(at: Date): PrizeWeek | null {
  const previous = prizeWeek(new Date(prizeWeek(at).start.getTime() - 7 * DAY_MS));
  return at.getTime() < previous.payoutEnds.getTime() ? previous : null;
}

/** True when a ranked start at `now` can finish a shift of `nominalSeconds` before Sunday 12:00 UTC. Ending exactly at the close is allowed. */
export function rankedStartFits(now: Date, nominalSeconds: number): boolean {
  if (!Number.isFinite(nominalSeconds) || nominalSeconds < 0) return false;
  const week = prizeWeek(now);
  const t = now.getTime();
  if (t < week.start.getTime() || t >= week.end.getTime()) return false;
  return t + nominalSeconds * 1000 <= week.end.getTime();
}

/** Catalog length. A demo `timeScale` shortens `minSeconds`; the window uses the unscaled shift. */
export function nominalShiftSeconds(ride: { minSeconds: number; timeScale: number }): number {
  const scale = ride.timeScale > 0 ? ride.timeScale : 1;
  return ride.minSeconds * scale;
}

export function seasonOf(weekId: string): { season: number; week: number; liveFinal: boolean } {
  const epoch = Date.parse(`${SEASON_EPOCH}T00:00:00.000Z`);
  const week = Date.parse(`${weekId}T00:00:00.000Z`);
  const n = Math.round((week - epoch) / (7 * DAY_MS));
  const index = ((n % SEASON_WEEKS) + SEASON_WEEKS) % SEASON_WEEKS;
  return { season: Math.floor((n - index) / SEASON_WEEKS) + 1, week: index + 1, liveFinal: index + 1 === LIVE_FINAL_WEEK };
}

export interface RankedDeclaration {
  id: string;
  wallet: string;
  tier: PrizeTier;
  paid: boolean;
  /** A ride promo. Counts in its own weekly slot, not in the free or paid caps. */
  promo?: boolean;
  /** Null when the driver never declared. A stamp after `startedAt` does not count. */
  declaredAt: number | null;
  startedAt: number;
}

export type AttemptReason = 'counted' | 'not-declared' | 'declared-late' | 'free-cap' | 'paid-cap' | 'promo-cap';

export interface ClassifiedStart extends RankedDeclaration {
  counted: boolean;
  reason: AttemptReason;
}

/** First declared starts in start order, per wallet. A late or missing declaration does not use a slot. */
export function classifyStarts(rows: readonly RankedDeclaration[]): ClassifiedStart[] {
  const order = [...rows].sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const free = new Map<string, number>();
  const paid = new Map<string, number>();
  const promo = new Map<string, number>();
  return order.map((row) => {
    if (row.declaredAt === null) return { ...row, counted: false, reason: 'not-declared' as const };
    if (row.declaredAt > row.startedAt) return { ...row, counted: false, reason: 'declared-late' as const };
    const bucket = row.promo ? 'promo' : row.paid ? 'paid' : 'free';
    const used = bucket === 'promo' ? promo : bucket === 'paid' ? paid : free;
    const cap = bucket === 'promo' ? PROMO_RANKED_STARTS : bucket === 'paid' ? PAID_RANKED_STARTS : FREE_RANKED_STARTS;
    const n = used.get(row.wallet) ?? 0;
    if (n >= cap) {
      const reason = bucket === 'promo' ? 'promo-cap' as const : bucket === 'paid' ? 'paid-cap' as const : 'free-cap' as const;
      return { ...row, counted: false, reason };
    }
    used.set(row.wallet, n + 1);
    return { ...row, counted: true, reason: 'counted' as const };
  });
}
