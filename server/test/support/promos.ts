import { PromoCode } from '../../src/domain/economy/promo-code.entity.js';
import type { PromoCreateInput, PromoEffect } from '../../src/domain/economy/promo.types.js';

/** The ticket effect most specs need: 2 tickets of the 1h tier, whichever pool is selling. */
export const ticketEffect = (over: Partial<Extract<PromoEffect, { kind: 'tickets' }>> = {}): PromoEffect => ({ kind: 'tickets', tier: '1h', poolId: null, credits: 2, ...over });

/** What an admin hands in: code HELLO, 2 × 1h tickets, 10 redemptions, 1 per wallet, from now, no end. */
export const promoInput = (over: Partial<PromoCreateInput> = {}): PromoCreateInput => ({
  code: 'HELLO', effect: ticketEffect(), description: null, maxRedemptions: 10, perWallet: 1, startsAt: null, expiresAt: null, note: null, ...over,
});

/** A stored promo code as of `now`. */
export const aPromo = (now: Date, over: Partial<PromoCreateInput> = {}): PromoCode => PromoCode.create({ ...promoInput(over), now });
