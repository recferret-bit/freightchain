import type { AchievementUnlock } from '../../../domain/achievements/achievement-unlock.entity.js';

export abstract class AchievementRepositoryPort {
  /** One statement; existing rows are skipped and not overwritten. Returns the achievement ids THIS call inserted, in request order. */
  abstract insertAll(unlocks: readonly AchievementUnlock[]): Promise<readonly string[]>;
  abstract listByWallet(wallet: string): Promise<AchievementUnlock[]>;
}
