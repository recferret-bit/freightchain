import type { UnsignedPaymentTx } from '../../../domain/economy/chain-transaction.js';
import type { ChainEventRecord, PoolChainState } from '../../../domain/economy/chain-events.js';

/** The transactions the server builds – each has its own compute-unit budget (programs/freightchain-pools/README.md "Compute units"). */
export type ChainTxKind = 'buy' | 'refund' | 'pay_prize' | 'close_pool';

/** What a built transaction costs on the network (docs/paid-tickets-plan.md §2.9). */
export interface FeeQuote {
  /** compute-unit price in micro-lamports: a percentile of the recent fees of the hot accounts, clamped to [min, max] */
  priorityMicrolamports: number;
  /** the compute-unit limit set on the transaction (measured CU × ~1.3) */
  computeUnits: number;
  /** base fee (5 000 per signature) + the priority fee on the whole limit */
  estimatedFeeLamports: number;
}

/** A transaction the server built for someone else to sign: the message is kept with the order so /submit can prove the signed bytes are the ones it built. */
export interface BuiltTransaction extends UnsignedPaymentTx {
  /** base64 of the compiled message – exactly the bytes every signer signs */
  message: string;
  /** who pays the network fee: the gas sponsor for buys and refunds when one is configured, else the signer */
  feePayer: string;
  computeUnits: number;
  priorityMicrolamports: number;
}

/** A transaction that touched the program (failed ones included: the cursor must be able to move past them; readEvents answers them `{ invalid }`). */
export interface ProgramSignature {
  signature: string;
  slot: number;
  failed: boolean;
}

export type SignatureStatus = 'processed' | 'confirmed' | 'finalized' | 'expired' | 'unknown';

/**
 * The only door to the pool program on Solana (the older `ChainPort` – plain SOL transfer + memo – goes away when the ride-level payment routes do).
 * The server never holds a key that can move user or pool funds: the gas sponsor's key pays network fees (and Ticket rent, returned at refund) and nothing else.
 * An RPC failure is a ServiceUnavailableError, never "not found"; a program that is not configured (no TICKET_PROGRAM_ID) is a ServiceUnavailableError too.
 */
export abstract class PoolChainPort {
  /** Unsigned `buy_ticket` (+ compute budget). `feePayer` = the sponsor key when one is configured (it also pays the Ticket rent, recorded as `rent_payer`),
      unless `selfPaid` (the wallet's daily sponsorship cap is used up, or the client fell back to paying its own fee). */
  abstract buildBuyTransaction(input: { payer: string; poolId: number; qty: number; orderId: string; selfPaid?: boolean }): Promise<BuiltTransaction>;
  /** Unsigned `fail_pool` (when `needsFail`) + `refund` for `buyer`, signed by `caller` (anyone); the price goes to the buyer, the rent to the ticket's rent payer.
      ConflictError when the buyer holds no Ticket account (never bought, or refunded already). */
  abstract buildRefundTransaction(input: { caller: string; poolId: number; buyer: string; needsFail: boolean; selfPaid?: boolean }): Promise<BuiltTransaction>;
  /** Unsigned `pay_prize` for the admin to sign AND send in Phantom (the admin pays its own fee). */
  abstract buildPayPrizeTransaction(input: { authority: string; poolId: number; to: string; lamports: number; rank: number }): Promise<BuiltTransaction>;
  /** Unsigned `close_pool` (treasuries read from the Pool and Config accounts), signed and paid by `authority`. NotFoundError when the pool does not exist. */
  abstract buildClosePoolTransaction(input: { authority: string; poolId: number }): Promise<BuiltTransaction>;

  /** The pool events of one transaction, in order. 'pending' = not visible at the configured commitment yet; `{ invalid }` = failed, unrelated, truncated or unreadable. */
  abstract readEvents(signature: string): Promise<ChainEventRecord[] | 'pending' | { invalid: string }>;
  /** The pool account (+ its vault's balance, read in the same slot), for (re)sync and `pool:register`. null = no such pool on chain. */
  abstract readPool(poolId: number): Promise<PoolChainState | null>;
  /** The next transactions after `after` (null = the newest ones), OLDEST FIRST, at most `limit`: the watcher handles them in order and moves its cursor to the last. */
  abstract recentProgramSignatures(after: string | null, limit: number): Promise<ProgramSignature[]>;
  /** A websocket subscription that calls back on every successful program transaction; returns the unsubscribe. A no-op without SOLANA_WS or a program. */
  abstract subscribeLogs(onSignature: (signature: string) => void): () => void;

  /** The current price of a transaction of `kind` writing to pool `poolId` (null = no pool yet: the program's recent fees). */
  abstract feeQuote(input: { poolId: number | null; kind: ChainTxKind }): Promise<FeeQuote>;
  /** A dry run (signatures not checked): `reason` names the program error when it would fail ("SoldOut: …"). */
  abstract simulate(tx: UnsignedPaymentTx): Promise<{ ok: true; unitsConsumed: number } | { ok: false; reason: string }>;
  /**
   * The gasless path: add the fee payer's signature to a transaction the user already signed and send it, re-sending until it is confirmed or `lastValidBlockHeight`
   * passes. THE security boundary: refuses (BadRequestError) any transaction whose message bytes differ from `expectedMessage`, whose fee payer is not the sponsor,
   * or that lacks a valid user signature, and a stale blockhash; 503 when no sponsor is configured or it is out of funds; 409 when it would fail or was dropped.
   */
  abstract cosignAndSend(input: { signedTransaction: string; expectedMessage: string; lastValidBlockHeight: number }): Promise<{ signature: string; lastValidBlockHeight: number }>;
  /** 'expired' = unknown to the network and past `lastValidBlockHeight` – it will never land. */
  abstract signatureStatus(signature: string, lastValidBlockHeight: number): Promise<SignatureStatus>;
}
