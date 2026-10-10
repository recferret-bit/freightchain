import { SettingsPrismaRepository } from '../../../src/infrastructure/prisma/repositories/settings.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { testPrisma, wipe } from '../../support/db.js';

describe('SettingsPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: SettingsPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new SettingsPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('a wiped table reads empty; upsert inserts, then updates the same key', async () => {
    expect(await repo.all()).toEqual([]);
    await repo.upsert('free_on_signup', 7);
    await repo.upsert('offline_free_rides', 3);
    await repo.upsert('free_on_signup', 11);
    const rows = await repo.all();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([{ key: 'free_on_signup', value: 11 }, { key: 'offline_free_rides', value: 3 }]));
  });
});
