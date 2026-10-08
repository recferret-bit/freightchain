import type { TicketOrder } from '../../../domain/economy/ticket-order.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/** Ticket orders. Everything that changes one runs under its wallet's player row lock (there is no version column). */
export abstract class TicketOrderRepositoryPort {
  abstract insert(order: TicketOrder, tx?: TransactionHandle): Promise<void>;
  abstract findById(id: string, tx?: TransactionHandle): Promise<TicketOrder | null>;
  /** The order a purchase event already paid – the idempotency check of settling it. */
  abstract findBySettlement(signature: string, eventIndex: number, tx?: TransactionHandle): Promise<TicketOrder | null>;
  /** The wallet's newest order still awaiting payment (it may have lapsed – the entity decides). */
  abstract findAwaitingByWallet(wallet: string, tx?: TransactionHandle): Promise<TicketOrder | null>;
  /** The wallet's paid orders in one pool, oldest first (a refund marks them refunded). */
  abstract listPaid(wallet: string, poolId: number, tx?: TransactionHandle): Promise<TicketOrder[]>;
  abstract save(order: TicketOrder, tx?: TransactionHandle): Promise<void>;
  /** What the wallet has paid for and not been refunded: lamports and tickets. */
  abstract totalsOf(wallet: string, tx?: TransactionHandle): Promise<{ lamports: number; tickets: number }>;
}
