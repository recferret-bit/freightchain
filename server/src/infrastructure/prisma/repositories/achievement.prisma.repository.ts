import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AchievementUnlock } from '../../../domain/achievements/achievement-unlock.entity.js';
import { AchievementRepositoryPort } from '../../../application/ports/achievements/achievement.repository.port.js';
import { AchievementUnlockMapper } from '../mappers/achievement-unlock.mapper.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class AchievementPrismaRepository extends AchievementRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** RETURNING is the only way to know which ids this statement inserted. A count cannot tell a concurrent caller apart. */
  async insertAll(unlocks: readonly AchievementUnlock[]): Promise<readonly string[]> {
    if (unlocks.length === 0) return [];
    const rows = await this.prisma.$queryRaw<{ achievementId: string }[]>`
      INSERT INTO "achievement"."AchievementUnlock" ("wallet", "achievementId", "earnedAt", "rideId")
      VALUES ${Prisma.join(unlocks.map((u) => Prisma.sql`(${u.wallet}, ${u.achievementId}, ${u.earnedAt}, ${u.rideId})`))}
      ON CONFLICT ("wallet", "achievementId") DO NOTHING
      RETURNING "achievementId"`;
    const inserted = new Set(rows.map((row) => row.achievementId));
    return unlocks.map((u) => u.achievementId).filter((id) => inserted.has(id));
  }

  async listByWallet(wallet: string): Promise<AchievementUnlock[]> {
    const rows = await this.prisma.achievementUnlock.findMany({ where: { wallet } });
    return rows.map((row) => AchievementUnlockMapper.toDomain(row));
  }
}
