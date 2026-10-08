import type { PaidTierId } from '../../../../domain/rides/ride-tier.js';

export class CreatePromoCommand {
  constructor(
    public readonly input: {
      code: string;
      tier: PaidTierId;
      /** null = whichever live pool of the tier is selling when it is redeemed */
      poolId: number | null;
      credits: number;
      maxRedemptions: number | null;
      perWallet: number;
      expiresAt: Date | null;
      note: string | null;
    },
  ) {}
}
