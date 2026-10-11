/** Rebuild a pending donation's transfer (fresh blockhash, the same reference) for a wallet that did not keep the first one – the phone's Solana Pay POST. */
export class GetDonationPaymentQuery {
  constructor(
    public readonly wallet: string,
    public readonly orderId: string,
  ) {}
}

export interface DonationPaymentDto {
  transaction: string;
  reference: string;
}
