import type { AchievementUnlock as UnlockRow } from '@prisma/client';
import { AchievementUnlock } from '../../../domain/achievements/achievement-unlock.entity.js';

export class AchievementUnlockMapper {
  static toDomain(row: UnlockRow): AchievementUnlock {
    return new AchievementUnlock(row.wallet, row.achievementId, row.earnedAt, row.rideId);
  }
}
