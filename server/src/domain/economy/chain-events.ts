/* What the pool program tells the world, decoded (docs/paid-tickets-plan.md §2.6 / §2.7). Field names follow the plan; the program workstream's
   programs/freightchain-pools/README.md is the final word – the chain adapter reconciles the two when it decodes real logs. */

export const CHAIN_EVENT_KINDS = ['PoolCreated', 'TicketBought', 'PoolActivated', 'Sponsored', 'PoolFailed', 'PoolCancelled', 'Refunded', 'PrizePaid', 'PoolClosed'] as const;
export type ChainEventKind = (typeof CHAIN_EVENT_KINDS)[number];

interface EventBase {
  /** the transaction it came from, and its position among that transaction's program events */
  signature: string;
  index: number;
  slot: number;
  poolId: number;
}

export type ChainEventRecord = EventBase & (
  | { kind: 'PoolCreated' }
  | { kind: 'TicketBought'; buyer: string; qty: number; lamports: number; orderId: string; ticketsSold: number; activated: boolean }
  | { kind: 'PoolActivated'; ticketsSold: number }
  | { kind: 'Sponsored'; sponsor: string; lamports: number }
  | { kind: 'PoolFailed'; ticketsSold: number }
  | { kind: 'PoolCancelled' }
  | { kind: 'Refunded'; buyer: string; lamports: number }
  | { kind: 'PrizePaid'; to: string; lamports: number; rank: number }
  | { kind: 'PoolClosed'; prizePaid: number; seed: number; fee: number; unclaimed: number }
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

/** The pool account as read from chain (PoolSyncService compares it with the mirror row; the chain wins). */
export interface PoolChainState {
  poolId: number;
  address: string;
  status: 'open' | 'active' | 'refunding' | 'settled';
  ticketsSold: number;
  buyers: number;
  sponsored: number;
  prizesPaid: number;
  refunded: number;
  vaultLamports: number;
}
