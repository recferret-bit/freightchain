import type { TicketOrderDto } from '../../../../domain/economy/ticket-order.dto.js';

export class GetPendingTicketOrderQuery {
  constructor(public readonly wallet: string) {}
}

export interface PendingTicketOrderDto {
  /** the wallet's order still awaiting payment and not lapsed, or null */
  order: TicketOrderDto | null;
}
