import type { Prisma, PromoCode as PromoCodeRow } from '@prisma/client';
import { isCosmeticSlot } from '../../../domain/economy/cosmetics.js';
import { PromoCode } from '../../../domain/economy/promo-code.entity.js';
import type { PromoEffect } from '../../../domain/economy/promo.types.js';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';

/** The effect is stored flat (one nullable column group per kind) so the atomic redemption UPDATE and the admin queries stay plain SQL. */
const effectOf = (row: PromoCodeRow): PromoEffect => {
  if (row.kind === 'free_rides') return { kind: 'free_rides', count: row.freeRides ?? 0 };
  if (row.kind === 'cosmetic' && isCosmeticSlot(row.cosmeticSlot)) return { kind: 'cosmetic', slot: row.cosmeticSlot, item: row.cosmeticItem ?? '' };
  return { kind: 'tickets', tier: row.tier as PaidTierId, poolId: row.poolId, credits: row.credits ?? 0 };
};

export class PromoMapper {
  static toDomain(row: PromoCodeRow): PromoCode {
    return PromoCode.restore({
      code: row.code, effect: effectOf(row), description: row.description, maxRedemptions: row.maxRedemptions, redeemed: row.redeemed, perWallet: row.perWallet,
      startsAt: row.startsAt, expiresAt: row.expiresAt, disabledAt: row.disabledAt, note: row.note, createdAt: row.createdAt,
    });
  }

  static toCreateData(promo: PromoCode): Prisma.PromoCodeCreateManyInput {
    const { effect: e, ...s } = promo.snapshot();
    return {
      ...s, kind: e.kind,
      poolId: e.kind === 'tickets' ? e.poolId : null, tier: e.kind === 'tickets' ? e.tier : null, credits: e.kind === 'tickets' ? e.credits : null,
      freeRides: e.kind === 'free_rides' ? e.count : null, cosmeticSlot: e.kind === 'cosmetic' ? e.slot : null, cosmeticItem: e.kind === 'cosmetic' ? e.item : null,
    };
  }
}
