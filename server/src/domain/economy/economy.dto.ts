import type { PrizePoolDto } from './prize-pool.dto.js';
import type { Split } from './prize-split.js';

/** one of the free ride's LEVELS (ride-trip.ts FREE_LEVELS) – the lobby's picker: `seconds` = FREE_RIDE_SECONDS × its multiple, `assist` = may ASSIST be on */
export interface FreeLevelDto {
  level: number;
  trip: string;
  name: string;
  seconds: number;
  completeDist: number;
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
  /** settlement (draw, payouts) is not built: the grand prize shown is what has ACCRUED */
  settled: boolean;
  solUsd: number | null;
  /** "≈ at the current price" – lamports are the truth */
  usd: { grand: number | null; top20: number | null; nextSeed: number | null; fees: number | null; entries: number | null };
  /** the escrowed pools on sale or running (the landing's pot = the sum of their escrow) */
  pools: PrizePoolDto[];
}

export type LeaderboardBoard = 'round' | 'all' | 'free';

export interface LeaderboardRowDto {
  rank: number;
  wallet: string;
  distance: number;
  rides: number;
}

export interface LeaderboardDto {
  board: LeaderboardBoard;
  round: { id: number; endsAt: number };
  /** the first `prizeRanks` rows of the round board share the 20 % top-20 pool. Paid boards rank only shifts whose recording the server verified. */
  prizeRanks: number;
  /** true = the paid boards count verified shifts only; false = shadow mode (verdicts are shown but not enforced yet) */
  verifiedOnly: boolean;
  rows: LeaderboardRowDto[];
}

export const PRIZE_RANKS = 20;
export const LEADERBOARD_SIZE = 20;
