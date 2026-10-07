import type { Split } from './prize-split.js';

export interface TierDto {
  id: string;
  usd: number;
  seconds: number;
  completeDist: number;
  /** null for the free tier or when no price is available */
  lamports: number | null;
  available: boolean;
}

export interface TiersDto {
  solUsd: number | null;
  treasury: string | null;
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
