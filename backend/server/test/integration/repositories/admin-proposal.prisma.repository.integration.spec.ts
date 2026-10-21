import { AdminProposalPrismaRepository } from '../../../src/infrastructure/prisma/repositories/admin-proposal.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, testPrisma, wipe } from '../../support/db.js';

describe('AdminProposalPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: AdminProposalPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new AdminProposalPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('one claim wins; a second claim does not', async () => {
    await repo.insert({ id: 'p', action: 'setting.update', target: 'k', proposerWallet: 'A', approverWallet: null, payload: { value: 1 }, status: 'pending', createdAt: T0, expiresAt: at(60), appliedAt: null, requestId: null });
    expect(await repo.claim('p', 'B', T0)).toBe(true);
    expect(await repo.claim('p', 'C', T0)).toBe(false);
    await repo.markApplied('p', at(1));
    expect((await repo.find('p'))?.status).toBe('applied');
  });
});
