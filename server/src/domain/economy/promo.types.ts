import type { PaidTierId } from '../rides/ride-tier.js';

/* A promo code adds tickets – an off-chain grant into a pool, i.e. a sponsored entry; it does NOT count towards the pool's minimum (docs/paid-tickets-plan.md §8).
   `redeemableBy` and the redemption rules live in the PromoCode entity of the ledger workstream. */

export interface PromoCodeProps {
  /** stored upper-case without spaces; redeemed case-insensitively */
  code: string;
  /** null = the newest open / active pool of `tier` */
  poolId: number | null;
  tier: PaidTierId;
  /** tickets per redemption */
  credits: number;
  /** null = unlimited */
  maxRedemptions: number | null;
  redeemed: number;
  perWallet: number;
  expiresAt: Date | null;
  disabledAt: Date | null;
  note: string | null;
  createdAt: Date;
}
