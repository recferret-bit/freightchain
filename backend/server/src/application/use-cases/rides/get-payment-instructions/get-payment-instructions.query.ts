export class GetPaymentInstructionsQuery {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
  ) {}
}

export interface PaymentInstructionsDto {
  treasury: string;
  lamports: number;
  /** the ride id – the transaction must carry it as a memo */
  memo: string;
  quoteExpiresAt: number | null;
  blockhash: string;
  lastValidBlockHeight: number;
  /** base64 of the unsigned transaction */
  transaction: string;
  /** Solana Pay reference on the memo. The phone QR does not carry it; the transaction does. */
  reference: string;
}
