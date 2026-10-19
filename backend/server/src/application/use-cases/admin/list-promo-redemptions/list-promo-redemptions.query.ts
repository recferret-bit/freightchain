import type { PromoRedemptionRowDto } from '../../../../domain/economy/promo.dto.js';

/** Admin: who used which promo code (newest first), optionally one code or one wallet. */
export class ListPromoRedemptionsQuery {
  constructor(
    public readonly limit: number,
    public readonly code: string | null,
    public readonly wallet: string | null,
  ) {}
}

export interface PromoRedemptionListDto {
  rows: PromoRedemptionRowDto[];
}
