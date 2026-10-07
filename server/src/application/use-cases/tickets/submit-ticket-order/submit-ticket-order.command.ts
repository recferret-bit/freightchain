import type { TicketOrderDto } from '../../../../domain/economy/ticket-order.dto.js';

export class SubmitTicketOrderCommand {
  constructor(
    public readonly wallet: string,
    public readonly orderId: string,
    /** base64 of the transaction the wallet signed (signTransaction – not sent) */
    public readonly signedTransaction: string,
  ) {}
}

export interface SubmitTicketOrderResultDto {
  signature: string;
  /** paid = settled at once · pending = sent and landed, the settlement follows (poll the order) */
  status: 'paid' | 'pending';
  order: TicketOrderDto;
}
