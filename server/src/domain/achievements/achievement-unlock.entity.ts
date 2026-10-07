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
  earnedAt: number | null;
  awardedAtRoundClose: boolean;
}
