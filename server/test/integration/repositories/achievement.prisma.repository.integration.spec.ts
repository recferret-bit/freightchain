import { AchievementPrismaRepository } from '../../../src/infrastructure/prisma/repositories/achievement.prisma.repository.js';
import { AchievementUnlock } from '../../../src/domain/achievements/achievement-unlock.entity.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('AchievementPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: AchievementPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new AchievementPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await seedPlayer(prisma, 'w'); });

  it('insertAll: one statement, existing unlocks skipped (never overwritten), returns the ids this call inserted', async () => {
    expect(await repo.insertAll([new AchievementUnlock('w', 'first-mile', T0, 'r1'), new AchievementUnlock('w', 'clean-run', T0, null)])).toEqual(['first-mile', 'clean-run']);
    expect(await repo.insertAll([new AchievementUnlock('w', 'first-mile', at(99), 'r9'), new AchievementUnlock('w', 'century', at(5), null)])).toEqual(['century']);
    const list = await repo.listByWallet('w');
    expect(list.map((u) => [u.achievementId, u.earnedAt.getTime(), u.rideId]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))).toEqual([
      ['century', at(5).getTime(), null], ['clean-run', T0.getTime(), null], ['first-mile', T0.getTime(), 'r1'],
    ]);
    expect(await repo.insertAll([])).toEqual([]);
    expect(await repo.listByWallet('nobody')).toEqual([]);
  });
});
