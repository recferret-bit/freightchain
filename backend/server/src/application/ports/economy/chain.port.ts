import type { ChainSignature, ChainTransaction, UnsignedPaymentTx } from '../../../domain/economy/chain-transaction.js';

export interface PaymentTxInput {
  payer: string;
  treasury: string;
  lamports: number;
  /** the ride id, or `fc-donation:<id>` */
  memo: string;
  /** read-only account on the FIRST transfer, so the payment can be found without the payer's history */
  reference?: string | null;
  /** further transfers in the same transaction (a donation's referrer share). The reference stays on the first transfer. */
  also?: readonly { to: string; lamports: number }[];
}

/** The only door to the Solana network. */
export abstract class ChainPort {
  /** An unsigned SOL transfer to the treasury with the memo – built per click (a blockhash lives ~60–90 s). */
  abstract buildPaymentTransaction(input: PaymentTxInput): Promise<UnsignedPaymentTx>;
  /** null = not visible at `confirmed` yet (retry). An RPC failure is a ServiceUnavailableError, never "not found". */
  abstract getTransaction(signature: string): Promise<ChainTransaction | null>;
  /** Newest-first successful transactions of a wallet (legacy orders that have no reference key). */
  abstract recentSignatures(wallet: string, limit: number): Promise<ChainSignature[]>;
  /** Newest-first transactions that mention `address` (a Solana Pay reference). */
  abstract signaturesForAddress(address: string, limit: number): Promise<ChainSignature[]>;
}
