import type { TicketOrderDto } from '../../../../domain/economy/ticket-order.dto.js';

/** The buyer paid from a phone: find the transaction by its reference key and settle it. */
export class ReconcileTicketOrderCommand {
  constructor(
    public readonly wallet: string,
    public readonly orderId: string,
  ) {}
}

export type ReconcileTicketOrderResultDto =
  | { status: 'paid'; order: TicketOrderDto }
  | { status: 'pending'; order: TicketOrderDto }
  | { status: 'not_found'; order: TicketOrderDto };
