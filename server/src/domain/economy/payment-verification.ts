import type { ChainTransaction } from './chain-transaction.js';

export interface ExpectedPayment {
  wallet: string;
  treasury: string;
  /** the ordered amount – the transfer must be at least this */
  lamports: number;
  /** the ride id */
  memo: string;
  /** when the order has one, the transaction must include this read-only account */
  reference?: string | null;
}

/** null = the transaction pays this order; otherwise why not. Scans ALL top-level instructions (wallets may add compute-budget etc.). */
export function verifyPayment(tx: ChainTransaction, expected: ExpectedPayment): string | null {
  if (tx.outcome === 'no_metadata') return 'transaction has no metadata';
  if (tx.outcome === 'failed') return 'transaction failed on chain';
  if (!tx.feePayerSigned || tx.feePayer !== expected.wallet) return 'not signed by your wallet';
  const paid = tx.transfers.some((t) => t.source === expected.wallet && t.destination === expected.treasury && t.lamports >= expected.lamports);
  if (!paid) return 'no transfer of the ordered amount from your wallet to the treasury';
  if (!tx.memos.includes(expected.memo)) return 'the memo does not match this ride';
  if (expected.reference && !(tx.accountKeys ?? []).includes(expected.reference)) return 'the reference key is missing';
  return null;
}

/** Did this history entry carry the ride id as a memo? Cheap pre-filter so reconcile fetches 0–1 transactions instead of up to 25. */
export const memoMentions = (memo: string | null, rideId: string): boolean => memo?.includes(rideId) ?? false;
