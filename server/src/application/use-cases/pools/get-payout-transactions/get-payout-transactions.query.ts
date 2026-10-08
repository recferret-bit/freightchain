export class GetPayoutTransactionsQuery {
  constructor(
    public readonly wallet: string,
    public readonly poolId: number,
  ) {}
}

export interface PayoutRankDto {
  rank: number;
  wallet: string;
  distance: number;
  rides: number;
  lamports: number;
  /** a PrizePaid event for this wallet was already seen */
  paid: boolean;
}

export interface PayoutTxDto {
  rank: number;
  to: string;
  lamports: number;
  transaction: string;
  message: string;
  lastValidBlockHeight: number;
}

/** What the admin signs in Phantom, in order: one pay_prize per unpaid rank, then close_pool once every rank is paid. */
export interface PayoutTransactionsDto {
  poolId: number;
  /** the program's bound on all prizes: prizeBps of (tickets sold × price + sponsored) */
  prizeLamports: number;
  ranks: PayoutRankDto[];
  transactions: PayoutTxDto[];
  /** close_pool (splits what is left to the seed / fee treasuries) – only once every rank is paid */
  close: { transaction: string; message: string; lastValidBlockHeight: number } | null;
}
