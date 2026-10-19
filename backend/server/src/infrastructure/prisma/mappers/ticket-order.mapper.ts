import type { OrderStatus as OrderStatusRow, TicketOrder as TicketOrderRow } from '@prisma/client';
import { TicketOrder } from '../../../domain/economy/ticket-order.entity.js';
import type { OrderStatus } from '../../../domain/economy/ticket-order.types.js';

export class TicketOrderMapper {
  static toDomain(row: TicketOrderRow): TicketOrder {
    return TicketOrder.restore({
      id: row.id, wallet: row.wallet, poolId: row.poolId, qty: row.qty, lamports: Number(row.lamports), status: row.status as OrderStatus, txMessage: row.txMessage,
      lastValidBlockHeight: row.lastValidBlockHeight === null ? null : Number(row.lastValidBlockHeight), createdAt: row.createdAt, paidAt: row.paidAt, refundedAt: row.refundedAt,
      signature: row.signature, eventIndex: row.eventIndex, paymentReference: row.paymentReference,
    });
  }

  static toData(order: TicketOrder) {
    const s = order.snapshot();
    return {
      ...s, status: s.status as OrderStatusRow, lamports: BigInt(s.lamports), lastValidBlockHeight: s.lastValidBlockHeight === null ? null : BigInt(s.lastValidBlockHeight),
    };
  }
}
