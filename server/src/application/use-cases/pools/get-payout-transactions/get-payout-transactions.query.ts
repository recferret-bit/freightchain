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

export interface SignableTxDto { transaction: string; message: string; lastValidBlockHeight: number }

/** What the admin signs in Phantom (program v4, pentest H5-B): the winners root is COMMITTED first (`commit`), public until `payFrom`; then one pay_prize per unpaid
    rank (anyone may send them; the admin pays the fee here), then close_pool once every rank is paid. A committed root that is not the ranking any more is struck
    with `veto` (only while no rank is paid) – the next call offers the commit again. */
export interface PayoutTransactionsDto {
  poolId: number;
  /** the program's bound on all prizes: prizeBps of (tickets sold × price + sponsored) */
  prizeLamports: number;
  ranks: PayoutRankDto[];
  /** base64 root on chain (null = none committed) and when it first pays */
  committedRoot: string | null;
  payFrom: number | null;
  /** commit_winners of the ranking – only while nothing is committed */
  commit: SignableTxDto | null;
  /** veto_winners – offered while a committed root has no paid rank */
  veto: SignableTxDto | null;
  /** pay_prize per unpaid rank – only once the committed root is the ranking and its lock is over */
  transactions: PayoutTxDto[];
  /** close_pool (splits what is left to the seed / fee treasuries) – only once every rank is paid */
  close: SignableTxDto | null;
  /** why nothing (more) can be signed now */
  note: string | null;
}
