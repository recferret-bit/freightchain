import { PrismaFinishRulesRepository } from '../../../src/infrastructure/stats/prisma-finish-rules.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { testPrisma } from '../../support/db.js';

describe('PrismaFinishRulesRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: PrismaFinishRulesRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new PrismaFinishRulesRepository(prisma); });
  afterAll(() => prisma.$disconnect());

  it('reports whether ride.Ride.finishRulesVersion exists', async () => {
    const stamped = await repo.stamp('missing-ride', 1);
    expect(typeof stamped).toBe('boolean');
  });
});
