/** One achievement a wallet has earned. Unlocks are only ever added – never removed. */
export class AchievementUnlock {
  constructor(
    readonly wallet: string,
    readonly achievementId: string,
    readonly earnedAt: Date,
    /** the ride whose end unlocked it; null when found by a later catch-up */
    readonly rideId: string | null,
  ) {}
}

export interface AchievementDto {
  id: string;
  name: string;
  desc: string;
  icon: string;
  family: string;
  /** 1 = Bronze … 4 = Platinum */
  tier: number;
  tierName: string;
  earnedAt: number | null;
  awardedAtRoundClose: boolean;
  /** how far along the wallet is (value clamped to the target) – the locked cards show it */
  progress: { value: number; target: number };
  /** the compressed NFT of an earned badge: null = none yet / not mintable; status planned | sent | minted | failed | skipped */
  nft: { status: string; assetId: string | null; signature: string | null } | null;
}
