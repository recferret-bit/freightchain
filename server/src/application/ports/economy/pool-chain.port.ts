import type { UnsignedPaymentTx } from '../../../domain/economy/chain-transaction.js';
import type { ChainEventRecord, PoolChainState } from '../../../domain/economy/chain-events.js';
import type { PledgeChainEvent } from '../../../domain/economy/pledge.types.js';

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

/** A transaction the server built for someone else to sign (and send: every signer pays its own network fee). */
export interface BuiltTransaction extends UnsignedPaymentTx {
  /** base64 of the compiled message – exactly the bytes every signer signs */
  message: string;
  /** who pays the network fee: the signer */
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
 * The server never holds a key that can move user or pool funds: the crank key (CRANK_SECRET) pays only its own fees. Every wallet pays its own network fee and Ticket rent.
 * An RPC failure is a ServiceUnavailableError, never "not found"; a program that is not configured (no TICKET_PROGRAM_ID) is a ServiceUnavailableError too.
 */
export abstract class PoolChainPort {
  /** Unsigned `buy_ticket` (+ compute budget), paid by `payer` (it also pays the Ticket rent, recorded as `rent_payer` and returned at refund / close). */
  abstract buildBuyTransaction(input: { payer: string; poolId: number; qty: number; orderId: string; reference?: string | null }): Promise<BuiltTransaction>;
  /** Unsigned `fail_pool` (when `needsFail`) + `refund` for `buyer`, signed by `caller` (anyone); the price goes to the buyer, the rent to the ticket's rent payer.
      ConflictError when the buyer holds no Ticket account (never bought, or refunded already). */
  abstract buildRefundTransaction(input: { caller: string; poolId: number; buyer: string; needsFail: boolean }): Promise<BuiltTransaction>;
  /** Unsigned `pay_prize` for the admin to sign AND send in Phantom (the admin pays its own fee). `attest`: when the winner has no VERIFIED attestation on chain
      yet, a `record_attestation` with these facts (signed by the same admin) goes first in the same transaction – the program pays no prize without one. */
  abstract buildPayPrizeTransaction(input: { authority: string; poolId: number; to: string; lamports: number; rank: number; attest?: { telemetryRoot: Uint8Array; verifiedKm: number } }): Promise<BuiltTransaction>;
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
  /** 'expired' = unknown to the network and past `lastValidBlockHeight` – it will never land (both answers from the primary RPC, else 503). */
  abstract signatureStatus(signature: string, lastValidBlockHeight: number): Promise<SignatureStatus>;
  /** Derives the on-chain Pledge PDA address [b"pledge", rideId(32), sponsor] */
  abstract pledgePda(rideId: Uint8Array | Buffer | number[], sponsor: string): string;
  /** Unsigned `create_pledge` for the sponsor to sign AND send: the cap (lamportsPerKm × targetKm) + the Pledge account's rent leave the sponsor's wallet. */
  abstract buildCreatePledgeTransaction(input: { sponsor: string; poolId: number; rideId: string; driver: string; lamportsPerKm: bigint; targetKm: number }): Promise<BuiltTransaction>;
  /** The pledge events of one transaction ('pending' / `{ invalid }` as readEvents). */
  abstract readPledgeEvents(signature: string): Promise<PledgeChainEvent[] | 'pending' | { invalid: string }>;
  /** Successful transactions that touched a pledge account, newest first (it is closed at settle / refund, its history stays). */
  abstract pledgeSignatures(pda: string): Promise<string[]>;
}
