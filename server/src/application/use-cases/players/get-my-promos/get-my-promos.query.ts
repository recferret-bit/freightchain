import type { MyPromoRedemptionDto } from '../../../../domain/economy/promo.dto.js';

/** The codes a wallet has redeemed (newest first) – the lobby's PROMO tab. */
export class GetMyPromosQuery {
  constructor(public readonly wallet: string) {}
}

export interface MyPromosDto {
  redemptions: MyPromoRedemptionDto[];
}
