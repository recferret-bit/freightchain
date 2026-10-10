import { ConflictError } from '../shared/errors.js';
import type { Pool } from './pool.entity.js';
import type { OrderStatus, TicketOrderProps } from './ticket-order.types.js';

/**
 * "n tickets of pool X" (docs/paid-tickets-plan.md §2.2, §2.7). The server builds the transaction; the program's TicketBought event pays it:
 *   awaiting_payment → paid       its event was verified (also after it lapsed – money that arrived is always honoured)
 *   awaiting_payment → expired    nobody paid within the order TTL
 *   paid → awaiting_payment       the finality pass saw its transaction dropped (never landed): pay again, nothing was charged
 *   paid → refunded               the pool failed and the program refunded the buyer
 * A purchase made without an order (straight from an explorer, or a mismatching one) is ADOPTED: a paid order is created from the event, so every
 * purchase is exactly one order row and (signature, eventIndex) makes settling it idempotent.
 */
export class TicketOrder {
  private constructor(private readonly p: TicketOrderProps) {}

  static create(i: { id: string; wallet: string; pool: Pool; qty: number; walletBought: number; now: Date }): TicketOrder {
    const why = i.pool.whyNotSellable(i.now, i.qty, i.walletBought);
    if (why) throw new ConflictError(why, 'not_sellable');
    return new TicketOrder({
      id: i.id, wallet: i.wallet, poolId: i.pool.id, qty: i.qty, lamports: i.pool.costOf(i.qty), status: 'awaiting_payment', txMessage: null, lastValidBlockHeight: null,
      createdAt: i.now, paidAt: null, refundedAt: null, signature: null, eventIndex: null,
    });
  }

  /** A purchase that arrived without a matching order. */
  static adopt(i: { id: string; wallet: string; poolId: number; qty: number; lamports: number; signature: string; eventIndex: number; now: Date }): TicketOrder {
    return new TicketOrder({
      id: i.id, wallet: i.wallet, poolId: i.poolId, qty: i.qty, lamports: i.lamports, status: 'paid', txMessage: null, lastValidBlockHeight: null,
      createdAt: i.now, paidAt: i.now, refundedAt: null, signature: i.signature, eventIndex: i.eventIndex,
    });
  }

  static restore(props: TicketOrderProps): TicketOrder {
    return new TicketOrder({ ...props });
  }

  get id(): string { return this.p.id; }
  get wallet(): string { return this.p.wallet; }
  get poolId(): number { return this.p.poolId; }
  get qty(): number { return this.p.qty; }
  get lamports(): number { return this.p.lamports; }
  get status(): OrderStatus { return this.p.status; }
  get txMessage(): string | null { return this.p.txMessage; }
  get signature(): string | null { return this.p.signature; }

  /** Still waiting for its payment and not lapsed. */
  isLive(now: Date, ttlMs: number): boolean {
    return this.p.status === 'awaiting_payment' && now.getTime() < this.p.createdAt.getTime() + ttlMs;
  }

  expiresAt(ttlMs: number): Date {
    return new Date(this.p.createdAt.getTime() + ttlMs);
  }

  /** The transaction the server built for it (the wallet signs and sends it itself). */
  attachTransaction(message: string, lastValidBlockHeight: number): void {
    this.mustBe('awaiting_payment');
    this.p.txMessage = message;
    this.p.lastValidBlockHeight = lastValidBlockHeight;
  }

  /** Does this purchase event pay exactly this order? null = yes; otherwise why not (the purchase is then adopted as its own order). */
  whyNotPaidBy(e: { buyer: string; poolId: number; qty: number; lamports: number }): string | null {
    if (e.buyer !== this.p.wallet) return 'paid by another wallet';
    if (e.poolId !== this.p.poolId) return 'paid into another pool';
    if (e.qty !== this.p.qty) return `paid for ${e.qty} tickets, ordered ${this.p.qty}`;
    if (e.lamports !== this.p.lamports) return `paid ${e.lamports} lamports, ordered ${this.p.lamports}`;
    return null;
  }

  markPaid(signature: string, eventIndex: number, now: Date): void {
    this.mustBe('awaiting_payment', 'expired');
    this.p.status = 'paid';
    this.p.paidAt = now;
    this.p.signature = signature;
    this.p.eventIndex = eventIndex;
  }

  expire(): void {
    this.mustBe('awaiting_payment');
    this.p.status = 'expired';
  }

  /** Its transaction never landed (finality pass): back to waiting, the settlement forgotten. */
  reopen(): void {
    this.mustBe('paid');
    this.p.status = 'awaiting_payment';
    this.p.paidAt = null;
    this.p.signature = null;
    this.p.eventIndex = null;
  }

  markRefunded(now: Date): void {
    if (this.p.status === 'refunded') return;
    this.mustBe('paid');
    this.p.status = 'refunded';
    this.p.refundedAt = now;
  }

  snapshot(): TicketOrderProps {
    return { ...this.p };
  }

  private mustBe(...statuses: OrderStatus[]): void {
    if (!statuses.includes(this.p.status)) throw new ConflictError(`order is ${this.p.status}`);
  }
}
