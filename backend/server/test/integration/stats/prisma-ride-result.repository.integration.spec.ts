import { PrismaRideResultRepository } from '../../../src/infrastructure/stats/prisma-ride-result.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { testPrisma } from '../../support/db.js';

describe('PrismaRideResultRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: PrismaRideResultRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new PrismaRideResultRepository(prisma); });
  afterAll(() => prisma.$disconnect());

  it('lists no rows for a pool that has none', async () => {
    expect(await repo.listByPool(9_999_999)).toEqual([]);
  });
});
