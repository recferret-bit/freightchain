import { Injectable } from '@nestjs/common';
import type { ChainEventRecord } from '../../domain/economy/chain-events.js';
import type { Pool } from '../../domain/economy/pool.entity.js';
import { TicketOrder } from '../../domain/economy/ticket-order.entity.js';
import { ConflictError } from '../../domain/shared/errors.js';
import { PoolRepositoryPort } from '../ports/economy/pool.repository.port.js';
import { TicketOrderRepositoryPort } from '../ports/economy/ticket-order.repository.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { RideTicketRepositoryPort } from '../ports/players/ride-ticket.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { EntropyPort } from '../ports/shared/entropy.port.js';
import { TransactionPort } from '../ports/shared/transaction.port.js';
import { PlayerSessionService } from './player-session.service.js';
import { RoundService } from './round.service.js';
import { withVersionRetry } from './version-retry.js';

export type PurchaseEvent = Extract<ChainEventRecord, { kind: 'TicketBought' }>;
export type RefundEvent = Extract<ChainEventRecord, { kind: 'Refunded' }>;
export type LifecycleEvent = Exclude<ChainEventRecord, PurchaseEvent | RefundEvent>;

/** What became of one event – the caller (the confirm fast path, the chain watcher) records it as the ChainEvent outcome. */
export type SettleOutcome =
  /** a purchase paid the order it names */
  | { outcome: 'settled'; order: TicketOrder; balance: number }
  /** applied without an order of its own: a purchase with no / a mismatching order (adopted – money in = tickets out), or a pool / refund event */
  | { outcome: 'applied'; order: TicketOrder | null; balance: number | null; detail: string | null; voided?: number }
  /** this (signature, index) was settled before – the order it paid */
  | { outcome: 'duplicate'; order: TicketOrder | null }
  /** the pool is not in the mirror yet: register it from its account and try again */
  | { outcome: 'unmatched'; detail: string }
  /** the mirror cannot make this transition: re-sync the pool from its account */
  | { outcome: 'invalid'; detail: string };

const NO_ORDER = '00000000-0000-0000-0000-000000000000';

/**
 * Applies verified program events to the mirror, each in ONE transaction, taking locks in the one order the codebase allows:
 * the wallet's player row → the pool row → ticket rows (a void holds the pool row and then ticket rows; nothing ever waits for a pool while holding a ticket row).
 * Idempotent: a purchase is keyed by its (signature, event index) on the order it paid; the pool's balances are recomputed from the program's running totals.
 */
@Injectable()
export class TicketSettlementService {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly tickets: RideTicketRepositoryPort,
    private readonly orders: TicketOrderRepositoryPort,
    private readonly sessions: PlayerSessionService,
    private readonly rounds: RoundService,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  /** TicketBought: the buyer's tickets (+qty), its order paid – or a new paid order adopted from the event – and the pool's counters. */
  async settlePurchase(e: PurchaseEvent): Promise<SettleOutcome> {
    await this.sessions.touch(e.buyer); // a wallet that bought straight from the explorer has no player row yet
    const round = await this.rounds.ensureRound(); // outside the lock: it may insert
    return withVersionRetry(() => this.transactions.run(async (tx): Promise<SettleOutcome> => {
      const now = this.clock.now();
      const player = await this.players.findByWalletForUpdate(e.buyer, tx);
      const pool = await this.pools.findByIdForUpdate(e.poolId, tx);
      if (!pool) return { outcome: 'unmatched', detail: `pool ${e.poolId} is not registered` };
      const done = await this.orders.findBySettlement(e.signature, e.index, tx);
      if (done) return { outcome: 'duplicate', order: done };

      const named = e.orderId && e.orderId !== NO_ORDER ? await this.orders.findById(e.orderId, tx) : null;
      const why = !named ? 'no order' : named.status === 'paid' || named.status === 'refunded' ? `order already ${named.status}` : named.whyNotPaidBy(e);
      let order: TicketOrder;
      if (named && why === null) {
        named.markPaid(e.signature, e.index, now);
        await this.orders.save(named, tx);
        order = named;
      } else {
        order = TicketOrder.adopt({ id: this.entropy.uuid(), wallet: e.buyer, poolId: e.poolId, qty: e.qty, lamports: e.lamports, signature: e.signature, eventIndex: e.index, now });
        await this.orders.insert(order, tx);
      }

      const ticket = await this.tickets.open(e.buyer, e.poolId, tx);
      if (ticket.bought === 0) pool.countBuyer();
      this.tryApply(pool, e, round.id); // an `invalid` here only means the mirror lags: the purchase is still credited and the pool is re-synced later
      await this.pools.upsert(pool, tx);
      ticket.recordPurchase(e.qty);
      await this.tickets.appendGrant({ wallet: e.buyer, poolId: e.poolId, delta: e.qty, source: 'payment', ref: e.signature, at: now }, tx);
      if (pool.isRefunding) { // the pool failed before this purchase was seen: what it bought is refundable, not rideable
        const voided = ticket.voidAll();
        await this.tickets.appendGrant({ wallet: e.buyer, poolId: e.poolId, delta: -voided, source: 'void', ref: `pool ${e.poolId}`, at: now }, tx);
      }
      const saved = await this.tickets.save(ticket, tx);
      if (player && e.lamports > 0 && e.qty > 0) { player.setTrustScore(100); await this.players.save(player, tx); } // verified paid acquisition; replayed events return above
      return why === null ? { outcome: 'settled', order, balance: saved.balance } : { outcome: 'applied', order, balance: saved.balance, detail: why };
    }));
  }

  /** Refunded: the buyer got every lamport back – its paid orders in the pool become refunded and its ticket row holds nothing paid any more. */
  async settleRefund(e: RefundEvent): Promise<SettleOutcome> {
    return withVersionRetry(() => this.transactions.run(async (tx): Promise<SettleOutcome> => {
      const now = this.clock.now();
      await this.players.findByWalletForUpdate(e.buyer, tx);
      const pool = await this.pools.findByIdForUpdate(e.poolId, tx);
      if (!pool) return { outcome: 'unmatched', detail: `pool ${e.poolId} is not registered` };
      const invalid = this.tryApply(pool, e);
      if (invalid) return invalid;
      await this.pools.upsert(pool, tx);
      const ticket = await this.tickets.find(e.buyer, e.poolId, tx);
      if (ticket && ticket.bought > 0) {
        ticket.markRefunded();
        await this.tickets.save(ticket, tx);
        await this.tickets.appendGrant({ wallet: e.buyer, poolId: e.poolId, delta: 0, source: 'refund', ref: e.signature, at: now }, tx);
      }
      for (const order of await this.orders.listPaid(e.buyer, e.poolId, tx)) {
        order.markRefunded(now);
        await this.orders.save(order, tx);
      }
      return { outcome: 'applied', order: null, balance: 0, detail: null };
    }));
  }

  /** Every other event: the pool's status and counters; a pool that turns refunding voids every unused ticket (TicketGrant `void`). */
  async applyPoolEvent(e: LifecycleEvent): Promise<SettleOutcome> {
    const round = e.kind === 'PoolActivated' ? await this.rounds.ensureRound() : null;
    return this.transactions.run(async (tx): Promise<SettleOutcome> => {
      const pool = await this.pools.findByIdForUpdate(e.poolId, tx);
      if (!pool) return { outcome: 'unmatched', detail: `pool ${e.poolId} is not registered` };
      const wasRefunding = pool.isRefunding;
      const invalid = this.tryApply(pool, e, round?.id);
      if (invalid) return invalid;
      await this.pools.upsert(pool, tx);
      const voided = pool.isRefunding && !wasRefunding ? await this.tickets.voidAllOfPool(pool.id, this.clock.now(), tx) : 0;
      return { outcome: 'applied', order: null, balance: null, detail: null, voided };
    });
  }

  /** Apply one event; a transition the mirror cannot make is an `invalid` outcome (the caller re-syncs the pool), never an exception. */
  private tryApply(pool: Pool, e: ChainEventRecord, roundId?: number): SettleOutcome | null {
    try {
      pool.applyEvent(e);
    } catch (error) {
      if (error instanceof ConflictError) return { outcome: 'invalid', detail: error.message };
      throw error;
    }
    if (pool.isActive && roundId !== undefined) pool.rankInRound(roundId);
    return null;
  }
}
