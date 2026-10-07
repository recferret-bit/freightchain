/** A chain-agnostic view of a confirmed transaction – only what payment verification needs. Built by the infrastructure adapter from the RPC's parsed transaction. */
export interface ChainTransfer {
  source: string;
  destination: string;
  lamports: number;
}

export type ChainTxOutcome = 'success' | 'failed' | 'no_metadata';

export interface ChainTransaction {
  outcome: ChainTxOutcome;
  /** account #0 – the fee payer */
  feePayer: string | null;
  feePayerSigned: boolean;
  /** every top-level system transfer */
  transfers: ChainTransfer[];
  /** every top-level memo, as plain text */
  memos: string[];
}

/** An entry of a wallet's recent history. `memo` is the RPC's own rendering – "[<len>] <text>", several memos joined by "; ". */
export interface ChainSignature {
  signature: string;
  memo: string | null;
}

export interface UnsignedPaymentTx {
  /** base64 of the unsigned transaction – the wallet signs and sends it */
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
}
