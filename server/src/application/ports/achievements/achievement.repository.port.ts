import type { AchievementUnlock } from '../../../domain/achievements/achievement-unlock.entity.js';

export abstract class AchievementRepositoryPort {
  /** One statement for all of them; ones that already exist are skipped (unlocks are only ever added). Returns how many were new. */
  abstract insertAll(unlocks: readonly AchievementUnlock[]): Promise<number>;
  abstract listByWallet(wallet: string): Promise<AchievementUnlock[]>;
}
