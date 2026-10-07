export class RedeemPromoCommand {
  constructor(
    public readonly wallet: string,
    public readonly code: string,
  ) {}
}

export interface PromoRedeemedDto {
  /** the normalized code */
  code: string;
  poolId: number;
  tier: string;
  /** tickets actually added (the grant is clamped at the pool's per-wallet cap) */
  added: number;
  balance: number;
  cap: number;
}
