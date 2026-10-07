import type { ChainSignature, ChainTransaction, UnsignedPaymentTx } from '../../../domain/economy/chain-transaction.js';

export interface PaymentTxInput {
  payer: string;
  treasury: string;
  lamports: number;
  /** the ride id */
  memo: string;
}

/** The only door to the Solana network. */
export abstract class ChainPort {
  /** An unsigned SOL transfer to the treasury with the memo – built per click (a blockhash lives ~60–90 s). */
  abstract buildPaymentTransaction(input: PaymentTxInput): Promise<UnsignedPaymentTx>;
  /** null = not visible at `confirmed` yet (retry). An RPC failure is a ServiceUnavailableError, never "not found". */
  abstract getTransaction(signature: string): Promise<ChainTransaction | null>;
  /** Newest-first successful transactions of a wallet (to find a payment whose confirm call never arrived). */
  abstract recentSignatures(wallet: string, limit: number): Promise<ChainSignature[]>;
}
