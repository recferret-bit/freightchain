import type { TransactionHandle } from '../shared/transaction.port.js';

export const SPONSORED_KINDS = ['buy', 'refund', 'session', 'deposit'] as const;
export type SponsoredKind = (typeof SPONSORED_KINDS)[number];

export interface SponsoredTxRow {
  signature: string;
  /** the wallet the sponsor paid for */
  wallet: string;
  kind: SponsoredKind;
  feeLamports: number;
  at: Date;
}

/** The gas sponsor's ledger: what the fee payer paid for whom (docs/paid-tickets-plan.md §2.10). Drives the per-wallet daily cap and the balance alarms. */
export abstract class SponsoredTxRepositoryPort {
  /** false when the signature is already recorded (never throws on a duplicate, so it is safe inside a transaction). */
  abstract record(row: SponsoredTxRow, tx?: TransactionHandle): Promise<boolean>;
  /** How many transactions the sponsor paid for this wallet at or after `since` (the cap passes startOfUtcDay(now)). */
  abstract countSince(wallet: string, since: Date, tx?: TransactionHandle): Promise<number>;
}
