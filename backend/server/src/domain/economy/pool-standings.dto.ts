import type { PayoutState } from './pool.types.js';

/** One rank of a pool's winners list. Before the payout it is PROVISIONAL (the ranking now, with what the rank would get); once the payout job wrote its plan
    the ranks and amounts are fixed, and `paid` / `signature` show what reached the wallet. */
export interface StandingRankDto {
  rank: number;
  wallet: string;
  /** metres of verified driving in this pool */
  distance: number;
  rides: number;
  lamports: number;
  paid: boolean;
  /** the pay_prize transaction (explorer link), null before it was sent */
  signature: string | null;
}

/** GET /api/pools/:id/standings – public: who wins what, and when (the landing and the lobby show it during the review window, so anyone can check). */
export interface PoolStandingsDto {
  poolId: number;
  tier: string;
  label: string;
  /** rides count until here (epoch ms) */
  playDeadline: number;
  /** prizes are paid from here (epoch ms) – the review window ends */
  payoutAt: number;
  /** the prize share of the pot now (lamports) */
  prizeLamports: number;
  /** true = ranks and amounts are fixed (the payout job wrote its plan) */
  final: boolean;
  payout: { state: PayoutState; note: string | null; held: boolean };
  /** completed rides of this pool still waiting for an admin's decision – the payout waits for every one */
  underReview: number;
  ranks: StandingRankDto[];
}
