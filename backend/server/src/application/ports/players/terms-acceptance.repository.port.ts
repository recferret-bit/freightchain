import type { TransactionHandle } from '../shared/transaction.port.js';
export interface TermsAcceptanceRecord {
  wallet: string;
  termsVersion: number;
  privacyVersion: number;
  acceptedAt: Date;
  age18: boolean;
}
export abstract class TermsAcceptanceRepositoryPort {
  /** Append once for this wallet/version pair, inside the player-locked transaction. */
  abstract insert(record: TermsAcceptanceRecord, tx: TransactionHandle): Promise<void>;
}
