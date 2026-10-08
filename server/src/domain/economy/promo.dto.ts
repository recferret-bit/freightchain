import type { PromoCode } from './promo-code.entity.js';
import type { PromoEffect, PromoState } from './promo.types.js';

/** One line saying what a code gives – the same words in the lobby, the admin page and the signed admin text. */
export function describeEffect(e: PromoEffect): string {
  switch (e.kind) {
    case 'tickets': return `${e.credits} × ${e.tier} ride ticket${e.credits === 1 ? '' : 's'}${e.poolId !== null ? ` (pool #${e.poolId})` : ''}`;
    case 'free_rides': return `${e.count} free ride${e.count === 1 ? '' : 's'}`;
    case 'cosmetic': return `${e.slot.replace('_', ' ')}: ${e.item}`;
  }
}

/** A promo code as the admin page and the admin CLI show it. Timestamps are epoch ms. `state` is as of the moment of the request. */
export interface PromoDto {
  code: string;
  effect: PromoEffect;
  /** `describeEffect(effect)` */
  label: string;
  /** the player-facing text */
  description: string | null;
  state: PromoState;
  maxRedemptions: number | null;
  redeemed: number;
  perWallet: number;
  startsAt: number;
  expiresAt: number | null;
  disabledAt: number | null;
  /** the admin's private note */
  note: string | null;
  createdAt: number;
}

export const toPromoDto = (promo: PromoCode, now: Date): PromoDto => {
  const s = promo.snapshot();
  return {
    code: s.code, effect: s.effect, label: describeEffect(s.effect), description: s.description, state: promo.stateAt(now), maxRedemptions: s.maxRedemptions, redeemed: s.redeemed,
    perWallet: s.perWallet, startsAt: s.startsAt.getTime(), expiresAt: s.expiresAt?.getTime() ?? null, disabledAt: s.disabledAt?.getTime() ?? null, note: s.note, createdAt: s.createdAt.getTime(),
  };
};

/** The admin's log of who used which code. */
export interface PromoRedemptionRowDto {
  code: string;
  wallet: string;
  /** the wallet's n-th use of this code */
  n: number;
  at: number;
  /** what the code gives (the code's own, read now – a code never changes) */
  label: string;
}

/** A redemption as its player sees it. */
export interface MyPromoRedemptionDto {
  code: string;
  label: string;
  description: string | null;
  kind: PromoEffect['kind'];
  at: number;
}
