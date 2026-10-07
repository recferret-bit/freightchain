import type { ChainCursor as ChainCursorDbRow, ChainEvent as ChainEventDbRow, SponsoredTx as SponsoredTxDbRow } from '@prisma/client';
import { CHAIN_EVENT_KINDS, CHAIN_EVENT_OUTCOMES, type ChainEventKind, type ChainEventOutcome, type ChainEventRow } from '../../../domain/economy/chain-events.js';
import type { ChainCursorRow } from '../../../application/ports/economy/chain-event.repository.port.js';
import { SPONSORED_KINDS, type SponsoredKind, type SponsoredTxRow } from '../../../application/ports/economy/sponsored-tx.repository.port.js';

const oneOf = <T extends string>(values: readonly T[], v: string, what: string): T => {
  if (!(values as readonly string[]).includes(v)) throw new Error(`unknown ${what} "${v}" in the database`);
  return v as T;
};
const num = (v: bigint | null): number | null => (v === null ? null : Number(v));
const big = (v: number | null): bigint | null => (v === null ? null : BigInt(v));

/** The chain context's rows (events, the watcher's cursor, the gas sponsor's ledger): BigInt lamports / slots / heights ⇄ numbers, the string enums checked. */
export class ChainEventMapper {
  static toDomain(r: ChainEventDbRow): ChainEventRow {
    return {
      signature: r.signature, index: r.index, kind: oneOf<ChainEventKind>(CHAIN_EVENT_KINDS, r.kind, 'event kind'), poolId: r.poolId, wallet: r.wallet, orderId: r.orderId,
      lamports: num(r.lamports), outcome: oneOf<ChainEventOutcome>(CHAIN_EVENT_OUTCOMES, r.outcome, 'event outcome'), detail: r.detail, at: r.at,
      finalizedAt: r.finalizedAt, lastValidBlockHeight: num(r.lastValidBlockHeight),
    };
  }

  static toCreateData(e: ChainEventRow) {
    return {
      signature: e.signature, index: e.index, kind: e.kind, poolId: e.poolId, wallet: e.wallet, orderId: e.orderId, lamports: big(e.lamports), outcome: e.outcome,
      detail: e.detail, at: e.at, finalizedAt: e.finalizedAt, lastValidBlockHeight: big(e.lastValidBlockHeight),
    };
  }

  static cursorToDomain(r: ChainCursorDbRow): ChainCursorRow {
    return { key: r.key, signature: r.signature, slot: num(r.slot), at: r.at };
  }

  static sponsoredToDomain(r: SponsoredTxDbRow): SponsoredTxRow {
    return { signature: r.signature, wallet: r.wallet, kind: oneOf<SponsoredKind>(SPONSORED_KINDS, r.kind, 'sponsored kind'), feeLamports: Number(r.feeLamports), at: r.at };
  }

  static sponsoredToCreateData(s: SponsoredTxRow) {
    return { signature: s.signature, wallet: s.wallet, kind: s.kind, feeLamports: BigInt(s.feeLamports), at: s.at };
  }
}
