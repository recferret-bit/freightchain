import { Injectable } from '@nestjs/common';
import type { AchievementUnlock } from '../../../domain/achievements/achievement-unlock.entity.js';
import { AchievementRepositoryPort } from '../../../application/ports/achievements/achievement.repository.port.js';
import { AchievementUnlockMapper } from '../mappers/achievement-unlock.mapper.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class AchievementPrismaRepository extends AchievementRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async insertAll(unlocks: readonly AchievementUnlock[]): Promise<number> {
    const { count } = await this.prisma.achievementUnlock.createMany({
      data: unlocks.map((u) => ({ wallet: u.wallet, achievementId: u.achievementId, earnedAt: u.earnedAt, rideId: u.rideId })),
      skipDuplicates: true,
    });
    return count;
  }

  async listByWallet(wallet: string): Promise<AchievementUnlock[]> {
    const rows = await this.prisma.achievementUnlock.findMany({ where: { wallet } });
    return rows.map((row) => AchievementUnlockMapper.toDomain(row));
  }
}
