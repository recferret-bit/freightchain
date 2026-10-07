export class GetTicketPaymentQuery {
  constructor(
    public readonly wallet: string,
    public readonly orderId: string,
    /** the client asks to pay its own network fee (its wallet cannot sign-only, or the gasless path failed) */
    public readonly selfPaid: boolean,
  ) {}
}

/** The unsigned buy_ticket transaction of an order. Sponsored = the server's gas sponsor is the fee payer: sign it (signTransaction) and POST it to /submit. */
export interface TicketPaymentDto {
  orderId: string;
  mode: 'program';
  programId: string;
  poolId: number;
  lamports: number;
  /** base64 of the unsigned transaction */
  transaction: string;
  /** base64 of its message – what /submit compares the signed bytes against */
  message: string;
  feePayer: string;
  sponsored: boolean;
  computeUnits: number;
  priorityMicrolamports: number;
  blockhash: string;
  /** the transaction can land until this block height (~60–90 s) – build a new one after */
  lastValidBlockHeight: number;
}
