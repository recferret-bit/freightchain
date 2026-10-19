export class GetRefundTransactionQuery {
  constructor(
    public readonly wallet: string,
    public readonly poolId: number,
  ) {}
}

/** The unsigned refund for the caller (with fail_pool first when the pool still has to be failed). The wallet signs and sends it; then POST /api/chain/settle. */
export interface RefundTransactionDto {
  poolId: number;
  /** the pool was still open past its preparation deadline: the transaction fails it first (anyone may) */
  needsFail: boolean;
  /** what comes back: everything this wallet paid into the pool */
  lamports: number;
  transaction: string;
  message: string;
  feePayer: string;
  lastValidBlockHeight: number;
}
