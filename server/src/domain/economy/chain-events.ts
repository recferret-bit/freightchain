import type { PaidTierId } from '../rides/ride-tier.js';

/* What the pool program tells the world, decoded (docs/agents/escrow.md). Field names are the camelCase of the program's events in
   programs/freightchain-pools/programs/freightchain_pools/src/events.rs – that file (and the committed IDL) is the final word; the chain adapter
   (infrastructure/solana/program-chain.adapter.ts) decodes into these, its spec decodes real LiteSVM logs (server/test/fixtures/chain/).
   Types: u8/u16/u32 → number; u64 lamports → number, decoded exactly through BigInt – a value above Number.MAX_SAFE_INTEGER (≈ 9 million SOL, unreachable for a pool)
   makes the transaction `{ invalid }` instead of being rounded; i64 unix seconds → Date; Pubkey → base58; order_id [u8; 16] → the uuid string (lowercase, 8-4-4-4-12).
   AuthorityProposed / AuthorityChanged / SeriesSet / PayoutAuthoritySet are program events too, but not POOL events: the decoder skips them (they still occupy their `index`). */

export const CHAIN_EVENT_KINDS = ['PoolCreated', 'TicketBought', 'PoolActivated', 'Sponsored', 'PoolFailed', 'PoolCancelled', 'PoolExpired', 'Refunded', 'PrizePaid', 'PoolClosed',
  // program v4 (pentest WP5): the road sealed (L4), the winners committed / vetoed (H5-B), a pledged ride's attestation (H4), a sponsor refunded (M8)
  'RoadSealed', 'WinnersCommitted', 'WinnersVetoed', 'RideAttestationRecorded', 'SponsorRefunded'] as const;
export type ChainEventKind = (typeof CHAIN_EVENT_KINDS)[number];

/** The program's tier byte (docs/agents/escrow.md). */
export const CHAIN_TIER_CODES: Readonly<Record<PaidTierId, number>> = { '1h': 1, '4h': 2, '8h': 3 };
export const tierFromChainCode = (code: number): PaidTierId | null => (Object.entries(CHAIN_TIER_CODES).find(([, c]) => c === code)?.[0] as PaidTierId | undefined) ?? null;

interface EventBase {
  /** the transaction it came from, and the event's position among that transaction's `Program data:` lines of the pool program (skipped kinds count too, so the
      (signature, index) key never shifts) */
  signature: string;
  index: number;
  slot: number;
  poolId: number;
}

/** The pool's rules as created. Always set by the decoder; optional only so hand-made events in tests may leave them out. */
export interface PoolCreatedFields {
  pool?: string;
  vault?: string;
  /** the creator (receives the vault rent minimum at close) */
  authority?: string;
  /** the tier byte – see CHAIN_TIER_CODES */
  tier?: number;
  priceLamports?: number;
  minTickets?: number;
  /** 0 = unlimited */
  maxTickets?: number;
  maxPerWallet?: number;
  prepDeadline?: Date;
  playDeadline?: Date;
  payoutAt?: Date;
  prizeBps?: number;
  seedBps?: number;
  feeBps?: number;
  /** omitted on a hand-made event = 0 */
  referralBps?: number;
  feeTreasury?: string;
  seedTreasury?: string;
  /** opened by `open_next_pool` from the tier's series (else `create_pool` by the admin) */
  fromSeries?: boolean;
  /** base64 of SHA-256(pool_id LE u32 || seedSlotHash || seedSlot LE u64) – the program computed it from the SlotHashes sysvar when the pool opened */
  seedCommitment?: string;
  /** the SlotHashes entry it was made from: the slot and its bank hash (base58) */
  seedSlot?: number;
  seedSlotHash?: string;
}

/* The *Total fields are running totals kept by the program: replaying an event that carries one is harmless, which is what lets the mirror recompute its balances instead of adding. */
export type ChainEventRecord = EventBase & (
  | ({ kind: 'PoolCreated' } & PoolCreatedFields)
  /** `qty` / `lamports` are THIS order's (lamports = price × qty), `ticketsSold` the pool's total after it */
  | { kind: 'TicketBought'; buyer: string; qty: number; lamports: number; orderId: string; ticketsSold: number; activated: boolean }
  /** emitted in the same transaction, right after the TicketBought that reached the minimum; `at` is the chain clock (always set by the decoder) */
  | { kind: 'PoolActivated'; ticketsSold: number; at?: Date }
  | { kind: 'Sponsored'; sponsor: string; lamports: number; sponsoredTotal: number }
  | { kind: 'PoolFailed'; ticketsSold: number }
  /** an admin cancelled an open pool: everyone is refunded */
  | { kind: 'PoolCancelled'; ticketsSold: number }
  /** an active pool nobody settled within the grace period after play_deadline: anyone moved it to refunding */
  | { kind: 'PoolExpired'; ticketsSold: number }
  /** the ticket price went back to `buyer`, the Ticket account's rent to `rentPayer` (the fee payer of the buy) */
  | { kind: 'Refunded'; buyer: string; rentPayer: string; qty: number; lamports: number; refundedTotal: number }
  | { kind: 'PrizePaid'; to: string; lamports: number; rank: number; prizesPaidTotal: number }
  /** cancelled = a fully refunded pool was swept (→ cancelled), otherwise an active pool was split (→ settled) */
  | { kind: 'PoolClosed'; prizePaid: number; seed: number; fee: number; platformFee: number; unclaimed: number; rentReturned: number; cancelled: boolean }
  /** v4: the road seed, fixed from the hash of `seedSlot` (a slot after the pool opened); seedCommitment / seedSlotHash base64 */
  | { kind: 'RoadSealed'; seedSlot: number; seedSlotHash: string; seedCommitment: string }
  /** v4: the winners root (base64), public until `payFrom` – nobody is paid before */
  | { kind: 'WinnersCommitted'; root: string; total: number; count: number; committedAt: Date; payFrom: Date; by: string }
  | { kind: 'WinnersVetoed'; root: string }
  /** v4: the payout key's verdict on one pledged ride (rideId base64 of the zero-padded uuid); its pledges settle from `settleFrom` */
  | { kind: 'RideAttestationRecorded'; pool: string; rideId: string; driver: string; telemetryRoot: string; verifiedKm: number; status: number; recordedAt: Date; settleFrom: Date }
  /** v4: a failed pool's sponsorship back to its sponsor */
  | { kind: 'SponsorRefunded'; sponsor: string; lamports: number; sponsorRefundedTotal: number }
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

/** The pool account as read from chain (PoolSyncService compares it with the mirror row; the chain wins; `pool:register` inserts the mirror row from it). Statuses are the program's 0..4. */
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
  /** the money in escrow: vaultLamports minus the vault's rent minimum (never negative) */
  escrowLamports: number;
  // ---- immutable since create_pool
  vault: string;
  /** the creator (receives the vault rent minimum at close); admin rights come from the program's Config.authority */
  authority: string;
  /** the tier byte – see CHAIN_TIER_CODES / tierFromChainCode */
  tier: number;
  priceLamports: number;
  minTickets: number;
  /** 0 = unlimited */
  maxTickets: number;
  maxPerWallet: number;
  prepDeadline: Date;
  playDeadline: Date;
  /** the end of the review window – prizes and the close only from here on */
  payoutAt: Date;
  prizeBps: number;
  seedBps: number;
  feeBps: number;
  /** omitted on an account read that predates the field = 0 */
  referralBps?: number;
  feeTreasury: string;
  seedTreasury: string;
  createdAt: Date;
  /** base64; undefined until the road is sealed (v4: a new pool's commitment is all zero until `seal_road`) */
  seedCommitment?: string;
  seedSlot?: number;
  /** base58 */
  seedSlotHash?: string;
  // ---- program v4 (pentest WP5); undefined on an account without them
  /** the slot whose hash will seal the road; 0 once sealed */
  sealSlot?: number;
  /** the platform cut snapshotted when the pool opened */
  platformFeeBps?: number;
  /** the committed winners (base64 root; null = none committed / vetoed) */
  winnersRoot?: string | null;
  winnersTotal?: number;
  winnersCount?: number;
  committedAt?: Date | null;
  /** the first moment a committed root pays (the review lock) */
  payFrom?: Date | null;
  /** bit r = leaf r paid (a u64 bitfield, kept exact) */
  paidMask?: bigint;
  sponsorRefunded?: number;
  openPledges?: number;
}

/** A tier's schedule as read from chain (the program's Series account, written by the admin's `set_series`). Pools tile time: the next one may be opened by
    anyone (the crank) from `nextOpenAt` on, on the grid `nextOpenAt + k × saleSecs`. */
export interface SeriesChainState {
  address: string;
  /** the tier byte – see CHAIN_TIER_CODES */
  tier: number;
  enabled: boolean;
  priceLamports: number;
  minTickets: number;
  maxTickets: number;
  maxPerWallet: number;
  /** sale window = cadence */
  saleSecs: number;
  playSecs: number;
  verifySecs: number;
  prizeBps: number;
  seedBps: number;
  feeBps: number;
  /** omitted = 0 */
  referralBps?: number;
  feeTreasury: string;
  seedTreasury: string;
  nextOpenAt: Date;
  poolsOpened: number;
  lastPoolId: number | null;
}
