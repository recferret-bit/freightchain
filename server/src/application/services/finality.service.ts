import { Injectable } from '@nestjs/common';
import type { ChainEventRow } from '../../domain/economy/chain-events.js';
import { ChainEventRepositoryPort } from '../ports/economy/chain-event.repository.port.js';
import { PoolChainPort } from '../ports/economy/pool-chain.port.js';
import { PoolRepositoryPort } from '../ports/economy/pool.repository.port.js';
import { TicketOrderRepositoryPort } from '../ports/economy/ticket-order.repository.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { RideTicketRepositoryPort } from '../ports/players/ride-ticket.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { TransactionPort, type TransactionHandle } from '../ports/shared/transaction.port.js';
import { PoolRegistryService } from './pool-registry.service.js';
import { withVersionRetry } from './version-retry.js';

/** What one finality pass did: `waiting` = still confirmed / unknown, asked again next pass. */
export interface FinalityPassDto {
  checked: number;
  finalized: number;
  dropped: number;
  waiting: number;
}

/** Larger than any block height: `signatureStatus` then never answers 'expired' (only 'unknown'), so an event whose expiry cannot be judged is never dropped. */
const NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;
const DROPPED = 'the network dropped this transaction (never finalized, past its last valid block height)';

/**
 * The finality pass (docs/paid-tickets-plan.md §2.7, §2.9). Tickets are credited at `confirmed`; every settled / applied event is re-checked here until it is final:
 *   finalized → stamped (`finalizedAt`);
 *   expired   → the transaction never landed for good (a fork reverted it and its blockhash is gone): its events become `dropped` and what it credited is undone
 *               in ONE transaction under the locks in the codebase's order – the buyers' player rows (sorted) → the pool rows (sorted) → ticket rows:
 *               the purchase no longer counts as bought and its unused tickets are voided (TicketGrant `void`, ref = the signature); the order it paid goes back to
 *               `awaiting_payment` (pay again, nothing was charged); an ADOPTED order (a purchase that came without a matching order) never was a request of the
 *               wallet, so it is closed as `expired` instead of reopened – a reopened one would pose as a live order. Afterwards each pool it touched is re-synced
 *               from its account (the chain wins on counters and status);
 *   anything else (processed / confirmed / unknown) → asked again on the next pass. NEVER dropped on 'unknown'.
 * Expiry needs the transaction's last valid block height. The settle handler records events without it (null), so it falls back to the height stored with the
 * order the purchase paid (the latest transaction the server built for it – never lower than that of the transaction that paid it, so it can only judge expiry
 * LATER, never early); with neither (adopted purchases, pool events) expiry is not judged – such an event waits until finalized. Lifecycle events of a dropped
 * transaction are not replayed backwards: the pool re-sync puts status and counters right; a dropped refund is simply re-sent (refunds are idempotent on chain).
 */
@Injectable()
export class FinalityService {
  constructor(
    private readonly chain: PoolChainPort,
    private readonly events: ChainEventRepositoryPort,
    private readonly orders: TicketOrderRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly tickets: RideTicketRepositoryPort,
    private readonly registry: PoolRegistryService,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  /** One pass over the oldest `limit` events not yet final. An RPC failure (503) ends the pass – the rest is asked next time. */
  async pass(limit = 200): Promise<FinalityPassDto> {
    const page = await this.events.listUnfinalized(limit);
    const bySignature = new Map<string, ChainEventRow[]>();
    for (const row of page) bySignature.set(row.signature, [...(bySignature.get(row.signature) ?? []), row]);
    if (page.length === limit && bySignature.size > 1) bySignature.delete(page.at(-1)!.signature); // a full page may have cut the newest transaction's rows short
    const result: FinalityPassDto = { checked: 0, finalized: 0, dropped: 0, waiting: 0 };
    for (const [signature, rows] of bySignature) {
      result.checked++;
      const status = await this.chain.signatureStatus(signature, (await this.lastValidBlockHeight(rows)) ?? NEVER_EXPIRES);
      if (status === 'finalized') {
        await this.events.markFinalized(signature, this.clock.now());
        result.finalized++;
      } else if (status === 'expired') {
        await this.drop(signature, rows);
        result.dropped++;
      } else {
        result.waiting++;
      }
    }
    return result;
  }

  /** The events' own height, else the one stored with the order a purchase of this transaction paid (see the class comment). */
  private async lastValidBlockHeight(rows: ChainEventRow[]): Promise<number | null> {
    const own = rows.find((r) => r.lastValidBlockHeight !== null)?.lastValidBlockHeight;
    if (own != null) return own;
    for (const r of rows) {
      if (r.kind !== 'TicketBought' || r.outcome !== 'settled') continue;
      const order = await this.orders.findBySettlement(r.signature, r.index);
      const height = order?.snapshot().lastValidBlockHeight;
      if (height != null) return height;
    }
    return null;
  }

  /** Undo what the transaction's `seen` events credited (idempotent: a second drop finds the rows dropped and changes nothing). Returns how many tickets were voided. */
  async drop(signature: string, seen: ChainEventRow[]): Promise<number> {
    const poolIds = new Set<number>();
    const voided = await withVersionRetry(() => this.transactions.run(async (tx) => {
      // the locks FIRST (they serialize concurrent drops of the same transaction), then re-read whether it is still live
      const isPurchase = (r: ChainEventRow) => r.kind === 'TicketBought' && r.wallet !== null && r.poolId !== null;
      for (const wallet of [...new Set(seen.filter(isPurchase).map((r) => r.wallet as string))].sort()) await this.players.findByWalletForUpdate(wallet, tx);
      const pools = [...new Set(seen.flatMap((r) => (r.poolId === null ? [] : [r.poolId])))].sort((a, b) => a - b);
      for (const id of pools) { poolIds.add(id); await this.pools.findByIdForUpdate(id, tx); }
      const rows = await this.stillLive(seen, tx);
      if (rows.length === 0) return 0;
      const purchases = rows.filter(isPurchase);
      let total = 0;
      for (const r of purchases) total += await this.revoke(r, tx);
      await this.events.markDropped(signature, DROPPED, tx);
      return total;
    }));
    for (const id of poolIds) await this.registry.syncFromChain(id).catch(() => null); // the periodic pool sync retries a failed read
    return voided;
  }

  /** The rows, re-read inside the transaction, that are not dropped yet (a concurrent pass may have dropped them first). */
  private async stillLive(seen: ChainEventRow[], tx: TransactionHandle): Promise<ChainEventRow[]> {
    const rows: ChainEventRow[] = [];
    for (const r of seen) {
      const row = await this.events.find(r.signature, r.index, tx);
      if (row && row.outcome !== 'dropped') rows.push(row);
    }
    return rows;
  }

  /** One purchase: its order reopened (or closed when adopted), the purchase taken off the wallet's tickets, an audit line. */
  private async revoke(r: ChainEventRow, tx: TransactionHandle): Promise<number> {
    const wallet = r.wallet as string, poolId = r.poolId as number;
    const order = await this.orders.findBySettlement(r.signature, r.index, tx);
    let qty = order?.qty ?? 0;
    if (!order && r.lamports) { // no order row (should not happen – every credited purchase has one): derive the count from the price
      const pool = await this.pools.findById(poolId, tx);
      qty = pool && pool.priceLamports > 0 ? Math.round(r.lamports / pool.priceLamports) : 0;
    }
    if (order?.status === 'paid') {
      order.reopen();
      if (r.outcome !== 'settled') order.expire(); // adopted: never a live order of the wallet's
      await this.orders.save(order, tx);
    }
    const ticket = qty > 0 ? await this.tickets.find(wallet, poolId, tx) : null;
    if (!ticket) return 0;
    const voided = ticket.revokePurchase(qty);
    await this.tickets.save(ticket, tx);
    await this.tickets.appendGrant({ wallet, poolId, delta: -voided, source: 'void', ref: r.signature, at: this.clock.now() }, tx);
    return voided;
  }
}
