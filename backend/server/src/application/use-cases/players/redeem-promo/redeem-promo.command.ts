import type { CosmeticSlot } from '../../../../domain/economy/cosmetics.js';
import type { PaidTierId } from '../../../../domain/rides/ride-tier.js';

export class RedeemPromoCommand {
  constructor(
    public readonly wallet: string,
    public readonly code: string,
  ) {}
}

/** What a redemption did – `kind` says which shape. `code` is the normalized code, `label` the one-line effect ("3 free rides"). */
export type PromoRedeemedDto =
  | {
      kind: 'tickets';
      code: string;
      label: string;
      poolId: number;
      tier: string;
      /** tickets actually added (the grant is clamped at the pool's per-wallet cap) */
      added: number;
      balance: number;
      cap: number;
    }
  | {
      kind: 'ride';
      code: string;
      label: string;
      tier: PaidTierId;
    }
  | {
      kind: 'free_rides';
      code: string;
      label: string;
      added: number;
      /** the wallet's free rides now (may be above its daily cap) */
      freeRides: number;
    }
  | {
      kind: 'cosmetic';
      code: string;
      label: string;
      slot: CosmeticSlot;
      item: string;
    };
