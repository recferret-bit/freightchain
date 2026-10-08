import type { PromoCode } from './promo-code.entity.js';

/** A promo code as the admin CLI prints it. Timestamps are epoch ms. */
export interface PromoDto {
  code: string;
  tier: string;
  /** null = the live pool of the tier still selling at redemption time */
  poolId: number | null;
  credits: number;
  maxRedemptions: number | null;
  redeemed: number;
  perWallet: number;
  expiresAt: number | null;
  disabledAt: number | null;
  note: string | null;
  createdAt: number;
}

export const toPromoDto = (promo: PromoCode): PromoDto => {
  const s = promo.snapshot();
  return {
    code: s.code, tier: s.tier, poolId: s.poolId, credits: s.credits, maxRedemptions: s.maxRedemptions, redeemed: s.redeemed, perWallet: s.perWallet,
    expiresAt: s.expiresAt?.getTime() ?? null, disabledAt: s.disabledAt?.getTime() ?? null, note: s.note, createdAt: s.createdAt.getTime(),
  };
};
