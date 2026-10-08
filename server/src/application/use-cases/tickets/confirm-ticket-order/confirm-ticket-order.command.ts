import type { TicketOrderDto } from '../../../../domain/economy/ticket-order.dto.js';

export class ConfirmTicketOrderCommand {
  constructor(
    public readonly wallet: string,
    public readonly orderId: string,
    public readonly signature: string,
  ) {}
}

/** paid = the order is paid (tickets credited) · pending = the transaction is not visible yet: ask again (the watcher settles it anyway) */
export type ConfirmTicketOrderResultDto = { status: 'paid'; order: TicketOrderDto } | { status: 'pending'; order: TicketOrderDto };
