import { DailySeedPrismaRepository } from '../../../src/infrastructure/prisma/repositories/daily-seed.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, inTx, testPrisma, wipe } from '../../support/db.js';

describe('DailySeedPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: DailySeedPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new DailySeedPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('the first claim of a tier and day stores its candidate; later claims get that seed back; another day or tier is its own', async () => {
    expect(await repo.claim('1h', '2026-10-10', 2_147_483_647, T0)).toBe(2_147_483_647);
    expect(await repo.claim('1h', '2026-10-10', 5, T0)).toBe(2_147_483_647);
    expect(await repo.claim('1h', '2026-10-11', 6, T0)).toBe(6);
    expect(await repo.claim('4h', '2026-10-10', 7, T0)).toBe(7);
    expect(await prisma.dailySeed.findMany({ orderBy: [{ tier: 'asc' }, { day: 'asc' }] })).toMatchObject([
      { tier: '1h', day: '2026-10-10', seed: 2_147_483_647, createdAt: T0 }, { tier: '1h', day: '2026-10-11', seed: 6 }, { tier: '4h', day: '2026-10-10', seed: 7 },
    ]);
  });

  it('inside transactions: two first claims racing get ONE seed (the second waits for the first to commit); a rolled-back first claim leaves the day free', async () => {
    const results = await Promise.all([1, 2, 3, 4].map((c) => inTx(prisma, (tx) => repo.claim('1h', '2026-10-10', c, T0, tx))));
    expect(new Set(results).size).toBe(1);
    await expect(inTx(prisma, async (tx) => { await repo.claim('8h', '2026-10-10', 9, T0, tx); throw new Error('rolled back'); })).rejects.toThrow('rolled back');
    expect(await repo.claim('8h', '2026-10-10', 10, T0)).toBe(10);
  });
});
