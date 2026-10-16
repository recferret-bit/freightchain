import type { PaidTierId } from '../rides/ride-tier.js';
import type { CosmeticSlot } from './cosmetics.js';

/* What redeeming a promo code does (one effect per code):
   - tickets: free paid-ride tickets of a tier – an off-chain grant into a pool, i.e. a sponsored entry; it does NOT count towards the pool's minimum (docs/promocodes.md)
   - free_rides: extra FREE rides on top of the daily ones – may take the balance above `freeRidesMax` (the daily refill only adds below the cap and never takes anything away)
   - cosmetic: a stored cab colour. Creating or redeeming one is refused (`visuals_are_honk`); new parts are minted by burning TEN4. Old unlocks stay wearable. */
export type PromoEffect =
  | { kind: 'tickets'; tier: PaidTierId; /** null = the live pool of the tier still selling at redemption time */ poolId: number | null; /** tickets per redemption */ credits: number }
  | { kind: 'free_rides'; count: number }
  | { kind: 'cosmetic'; slot: CosmeticSlot; item: string };

export type PromoKind = PromoEffect['kind'];
export const PROMO_KINDS: readonly PromoKind[] = ['tickets', 'free_rides', 'cosmetic'];

export interface PromoCodeProps {
  /** stored upper-case without spaces; redeemed case-insensitively */
  code: string;
  effect: PromoEffect;
  /** shown to the player (lobby, redemption list); null = none */
  description: string | null;
  /** null = unlimited */
  maxRedemptions: number | null;
  redeemed: number;
  perWallet: number;
  /** redeemable from this instant */
  startsAt: Date;
  /** …until this instant (null = no end) */
  expiresAt: Date | null;
  disabledAt: Date | null;
  /** the admin's private note */
  note: string | null;
  createdAt: Date;
}

/** What an admin (page or CLI) hands in to create a code; `startsAt` null = from now. */
export interface PromoCreateInput {
  code: string;
  effect: PromoEffect;
  description: string | null;
  maxRedemptions: number | null;
  perWallet: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  note: string | null;
}

/** Where a code stands at an instant. `disabled` wins over everything; `exhausted` = every redemption taken. */
export type PromoState = 'scheduled' | 'active' | 'ended' | 'exhausted' | 'disabled';
