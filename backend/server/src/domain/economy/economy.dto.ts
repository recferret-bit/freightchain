import type { PrizePoolDto } from './prize-pool.dto.js';
import type { Split } from './prize-split.js';
import type { PaidTierId } from '../rides/ride-tier.js';
import type { FreeLevel } from '../rides/ride-trip.js';

/** one of the free ride's LEVELS (ride-trip.ts FREE_LEVELS) – the lobby's picker: `seconds` = FREE_RIDE_SECONDS × its multiple, `tutorial` / `assist` = may that helper be on */
export interface FreeLevelDto {
  level: number;
  trip: string;
  name: string;
  seconds: number;
  completeDist: number;
  tutorial: boolean;
  assist: boolean;
}

export interface TierDto {
  id: string;
  usd: number;
  seconds: number;
  completeDist: number;
  /** null for the free tier, an off-sale tier with no pool, or when no price is available */
  lamports: number | null;
  available: boolean;
  /** false = planned, not sold. A live pool of the tier still sells. */
  onSale: boolean;
  /** the tier's pool series: a new pool every `saleHours`, rides count `playHours` past the sale, `reviewHours` of review before prizes (null = none) */
  schedule: { saleHours: number; playHours: number; reviewHours: number } | null;
  /** paid tiers: the escrowed pool its tickets are sold into right now (null = none). An on-sale tier with none uses the legacy pay-per-ride order; an off-sale tier is marked soon. */
  pool: PrizePoolDto | null;
  /** the free tier only: its levels, easiest first (its own `seconds` / `completeDist` are level 1's) */
  levels?: FreeLevelDto[];
}

export interface TiersDto {
  solUsd: number | null;
  treasury: string | null;
  /** 'program' = escrow pools via the Anchor program, 'transfer' = plain transfers (fallback) */
  paymentMode: 'program' | 'transfer';
  tiers: TierDto[];
}

export interface PoolDto {
  round: { id: number; startsAt: number; endsAt: number };
  entries: number;
  split: Split;
  /** settlement / payouts not built: the grand prize shown is what has ACCRUED */
  settled: boolean;
  solUsd: number | null;
  /** "≈ at the current price" – lamports are the truth */
  usd: { grand: number | null; top20: number | null; nextSeed: number | null; fees: number | null; entries: number | null };
  /** the escrowed pools on sale or running (the landing's pot = the sum of their escrow) */
  pools: PrizePoolDto[];
}

export type LeaderboardBoard = 'round' | 'all' | 'free';
/** what the list is ordered by. `distance` is the prize order; the others re-order the same totals. */
export type LeaderboardSort = 'distance' | 'time' | 'hull' | 'rides';

export interface LeaderboardRowDto {
  rank: number;
  wallet: string;
  distance: number;
  /** total drive time of the counted shifts, seconds */
  seconds: number;
  /** hull (0–100) left at the end of the furthest counted shift; null when that shift reported none */
  hull: number | null;
  rides: number;
  /** primary Solana Name Service (.sol) domain name, or null */
  sns?: string | null;
}

/** the signed-in rider's distance rank on one board. `rank` null = no counted shift there.
    Paid boards are one rank per shift length (`tier`); the free board is one rank per level (`tier` null). */
export interface LeaderboardStandingDto {
  board: LeaderboardBoard;
  level: FreeLevel | null;
  tier: PaidTierId | null;
  rank: number | null;
  distance: number;
  seconds: number;
  hull: number | null;
  rides: number;
}

export interface LeaderboardDto {
  board: LeaderboardBoard;
  /** the free board's LEVEL (1 EASY · 2 MEDIUM · 3 HARD – ride-trip.ts FREE_LEVELS): only completed free rides on that level's trip rank; null on the paid boards */
  level: FreeLevel | null;
  /** the paid board's shift (1h / 4h / 8h). Null on the free board, and on a paid board that asked for every paid shift. */
  tier: PaidTierId | null;
  round: { id: number; endsAt: number };
  /** the first `prizeRanks` rows of the round board, in distance order, share the 20 % top-20 pool. Paid boards rank only shifts whose recording the server verified. */
  prizeRanks: number;
  /** true = the paid boards count verified shifts only; false = shadow mode (verdicts are shown but not enforced yet) */
  verifiedOnly: boolean;
  sort: LeaderboardSort;
  page: number;
  pageSize: number;
  /** places the list shows: the wallet count, capped at `LEADERBOARD_SIZE` */
  total: number;
  rows: LeaderboardRowDto[];
  /** the signed-in rider's place in THIS sort (null = signed out, or no counted shift on this board). Rank is not capped at the top 100. */
  me: { rank: number; distance: number; seconds: number; hull: number | null; rides: number } | null;
  /** distance rank on this round and all time, each paid shift, and each free level. Null when the request did not ask (`me=1`) or nobody is signed in. */
  standing: LeaderboardStandingDto[] | null;
}

export const PRIZE_RANKS = 20;
/** how many places the lobby lists */
export const LEADERBOARD_SIZE = 100;
/** places on one page of that list */
export const LEADERBOARD_PAGE = 25;
export const LEADERBOARD_PAGES = LEADERBOARD_SIZE / LEADERBOARD_PAGE;
/** the free board's level when the request names none: HARD – the ranking that means something (one HARD run outdistances any number of EASY ones) */
export const DEFAULT_BOARD_LEVEL: FreeLevel = 3;
