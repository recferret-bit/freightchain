import type { PayoutState } from '../../../../domain/economy/pool.types.js';

/** One payout pass (PAYOUT_SECRET – the program's payout_authority): every active pool whose review window is over, or only `poolId`. */
export class PayPoolsCommand {
  constructor(readonly poolId: number | null = null) {}
}

export interface PaidPrizeDto {
  rank: number;
  wallet: string;
  lamports: number;
  signature: string;
}

export interface PoolPayoutResultDto {
  poolId: number;
  /** where the pool stands after this pass (also saved on the pool) */
  state: PayoutState;
  note: string | null;
  /** prizes this pass paid */
  paid: PaidPrizeDto[];
  /** the close_pool signature when this pass settled the pool */
  closed: string | null;
}

export interface PayoutPassDto {
  /** false = no PAYOUT_SECRET, no program, or the program names another payout key (`refused` says which) */
  enabled: boolean;
  /** the payout key's address */
  payout: string | null;
  refused: string | null;
  /** the chain clock the pass judged payout times by (epoch ms) */
  chainNow: number | null;
  pools: PoolPayoutResultDto[];
}
