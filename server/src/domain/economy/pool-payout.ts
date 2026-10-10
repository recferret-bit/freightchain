/*
 * One prize the server's payout job pays from a pool (programs/freightchain-pools: `pay_prize` signed by the payout key). The plan is fixed once written
 * (ranks 1..n from the pool's verified ranking, the amounts of pool-payouts.ts), and every row walks planned → sent → paid. `sent` is CLAIMED with a
 * conditional update before the transaction goes out, so two payout passes can never both send the same prize; a row left `sent` by a crash is resolved
 * from its signature's status (landed → paid, expired → planned again), never by sending blind. The program caps the sum at the pool's prize share anyway.
 */
export const POOL_PAYOUT_STATUSES = ['planned', 'sent', 'paid'] as const;
export type PoolPayoutStatus = (typeof POOL_PAYOUT_STATUSES)[number];

export interface PoolPayoutRecord {
  poolId: number;
  rank: number;
  wallet: string;
  lamports: number;
  status: PoolPayoutStatus;
  signature: string | null;
  lastValidBlockHeight: number | null;
  attempts: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A planned prize (status `paid` when the wallet was already paid on chain before the plan was written – e.g. by the admin's own hand). */
export interface PlannedPayout {
  poolId: number;
  rank: number;
  wallet: string;
  lamports: number;
  status: 'planned' | 'paid';
}
