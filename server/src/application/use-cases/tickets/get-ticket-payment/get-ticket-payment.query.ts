export class GetTicketPaymentQuery {
  constructor(
    public readonly wallet: string,
    public readonly orderId: string,
  ) {}
}

/** The unsigned buy_ticket transaction of an order: the wallet signs AND sends it (it pays the network fee and the Ticket rent), then POSTs the signature to /confirm. */
export interface TicketPaymentDto {
  orderId: string;
  mode: 'program';
  programId: string;
  poolId: number;
  lamports: number;
  /** base64 of the unsigned transaction */
  transaction: string;
  /** base64 of its message (kept on the order) */
  message: string;
  feePayer: string;
  computeUnits: number;
  priorityMicrolamports: number;
  blockhash: string;
  /** the transaction can land until this block height (~60–90 s) – build a new one after */
  lastValidBlockHeight: number;
}
