import type { PromoCode as PromoCodeRow } from '@prisma/client';
import { PromoCode } from '../../../domain/economy/promo-code.entity.js';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';

export class PromoMapper {
  static toDomain(row: PromoCodeRow): PromoCode {
    return PromoCode.restore({
      code: row.code, poolId: row.poolId, tier: row.tier as PaidTierId, credits: row.credits, maxRedemptions: row.maxRedemptions, redeemed: row.redeemed,
      perWallet: row.perWallet, expiresAt: row.expiresAt, disabledAt: row.disabledAt, note: row.note, createdAt: row.createdAt,
    });
  }

  static toCreateData(promo: PromoCode) {
    return { ...promo.snapshot() };
  }
}
