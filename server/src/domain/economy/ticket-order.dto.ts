import type { TicketOrder } from './ticket-order.entity.js';
import type { OrderStatus } from './ticket-order.types.js';

/** A ticket order on the wire (the lobby polls it until `paid`). Timestamps are epoch ms. */
export interface TicketOrderDto {
  id: string;
  poolId: number;
  qty: number;
  lamports: number;
  status: OrderStatus;
  createdAt: number;
  /** when an unpaid order lapses */
  expiresAt: number;
  paidAt: number | null;
  refundedAt: number | null;
  /** the transaction that paid it */
  signature: string | null;
  /** Solana Pay reference, once the order has one */
  reference: string | null;
}

export const toTicketOrderDto = (order: TicketOrder, ttlMs: number): TicketOrderDto => {
  const s = order.snapshot();
  return {
    id: s.id, poolId: s.poolId, qty: s.qty, lamports: s.lamports, status: s.status, createdAt: s.createdAt.getTime(), expiresAt: order.expiresAt(ttlMs).getTime(),
    paidAt: s.paidAt?.getTime() ?? null, refundedAt: s.refundedAt?.getTime() ?? null, signature: s.signature, reference: s.paymentReference ?? null,
  };
};
