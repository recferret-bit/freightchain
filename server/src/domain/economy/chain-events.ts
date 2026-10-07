/* What the pool program tells the world, decoded (docs/paid-tickets-plan.md §2.6 / §2.7). Field names are the camelCase of the program's events in
   programs/freightchain-pools/programs/freightchain_pools/src/events.rs – that file (and the committed IDL) is the final word; the chain adapter decodes into these. */

export const CHAIN_EVENT_KINDS = ['PoolCreated', 'TicketBought', 'PoolActivated', 'Sponsored', 'PoolFailed', 'PoolCancelled', 'PoolExpired', 'Refunded', 'PrizePaid', 'PoolClosed'] as const;
export type ChainEventKind = (typeof CHAIN_EVENT_KINDS)[number];

interface EventBase {
  /** the transaction it came from, and its position among that transaction's program events */
  signature: string;
  index: number;
  slot: number;
  poolId: number;
}

/* The *Total fields are running totals kept by the program: replaying an event that carries one is harmless, which is what lets the mirror recompute its balances instead of adding. */
export type ChainEventRecord = EventBase & (
  | { kind: 'PoolCreated' }
  | { kind: 'TicketBought'; buyer: string; qty: number; lamports: number; orderId: string; ticketsSold: number; activated: boolean }
  | { kind: 'PoolActivated'; ticketsSold: number }
  | { kind: 'Sponsored'; sponsor: string; lamports: number; sponsoredTotal: number }
  | { kind: 'PoolFailed'; ticketsSold: number }
  /** an admin cancelled an open pool: everyone is refunded */
  | { kind: 'PoolCancelled'; ticketsSold: number }
  /** an active pool nobody settled within the grace period after play_deadline: anyone moved it to refunding */
  | { kind: 'PoolExpired'; ticketsSold: number }
  | { kind: 'Refunded'; buyer: string; rentPayer: string; qty: number; lamports: number; refundedTotal: number }
  | { kind: 'PrizePaid'; to: string; lamports: number; rank: number; prizesPaidTotal: number }
  /** cancelled = a fully refunded pool was swept (→ cancelled), otherwise an active pool was split (→ settled) */
  | { kind: 'PoolClosed'; prizePaid: number; seed: number; fee: number; platformFee: number; unclaimed: number; rentReturned: number; cancelled: boolean }
);

/** What became of an observed event (the ChainEvent table's `outcome`). */
export const CHAIN_EVENT_OUTCOMES = ['settled', 'unmatched', 'invalid', 'duplicate', 'applied', 'dropped'] as const;
export type ChainEventOutcome = (typeof CHAIN_EVENT_OUTCOMES)[number];

/** One stored line of the event log – nothing observed on chain is ever lost silently; (signature, index) makes handling idempotent. */
export interface ChainEventRow {
  signature: string;
  index: number;
  kind: ChainEventKind;
  poolId: number | null;
  wallet: string | null;
  orderId: string | null;
  lamports: number | null;
  outcome: ChainEventOutcome;
  detail: string | null;
  at: Date;
  /** stamped by the finality pass */
  finalizedAt: Date | null;
  lastValidBlockHeight: number | null;
}

/** The pool account as read from chain (PoolSyncService compares it with the mirror row; the chain wins). Statuses are the program's 0..4. */
export interface PoolChainState {
  poolId: number;
  address: string;
  status: 'open' | 'active' | 'refunding' | 'settled' | 'cancelled';
  ticketsSold: number;
  buyers: number;
  sponsored: number;
  prizesPaid: number;
  refunded: number;
  /** what the vault account holds, INCLUDING its rent-exempt minimum (the escrow is this minus the minimum) */
  vaultLamports: number;
}
