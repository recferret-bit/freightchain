import type { ChainEventKind, ChainEventOutcome, ChainEventRow } from './chain-events.js';

/** A blockhash is valid for 151 blocks (~60–90 s): the conservative end is what a client may plan with before it must rebuild the transaction. */
export const BLOCKHASH_TTL_SECONDS = 60;

/** GET /api/chain/fees – what the lobby shows next to BUY (docs/paid-tickets-plan.md §2.4 / §2.9). */
export interface ChainFeesDto {
  /** the compute-unit price a ticket purchase is built with now (µL/CU) */
  priorityMicrolamports: number;
  /** the compute-unit limit of a purchase */
  computeUnits: number;
  /** what the network charges for it (base fee per signature + priority fee) – paid by the gas sponsor when `sponsored` */
  estimatedFeeLamports: number;
  /** a gas sponsor is configured: the buyer pays only the ticket price */
  sponsored: boolean;
  blockhashTtlSeconds: number;
}

/** One line of a pool's on-chain history (GET /api/pools/:id `recent`) – the receipt the explorer link backs up. Timestamps epoch ms. */
export interface ChainEventDto {
  signature: string;
  kind: ChainEventKind;
  wallet: string | null;
  lamports: number | null;
  /** settled / applied / duplicate / unmatched / invalid / dropped (the network dropped the transaction: what it credited was undone) */
  outcome: ChainEventOutcome;
  /** when the server saw it */
  at: number;
  /** stamped final by the finality pass */
  finalized: boolean;
}

export const toChainEventDto = (e: ChainEventRow): ChainEventDto => ({
  signature: e.signature, kind: e.kind, wallet: e.wallet, lamports: e.lamports, outcome: e.outcome, at: e.at.getTime(), finalized: e.finalizedAt !== null,
});
