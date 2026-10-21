import { AlertOutboxPrismaRepository } from '../../../src/infrastructure/prisma/repositories/alert-outbox.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, testPrisma, wipe } from '../../support/db.js';

describe('AlertOutboxPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: AlertOutboxPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new AlertOutboxPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('stores a pending alert and counts none undelivered until a retry gives up', async () => {
    await repo.insert({ id: 'a1', kind: 'test', text: 'hello', money: false, status: 'pending', attempts: 0, nextAttemptAt: T0, lastError: null, createdAt: T0, sentAt: null, requestId: null });
    expect(await repo.due(T0, 10)).toHaveLength(1);
    await repo.markSent('a1', T0);
    expect(await repo.countUndelivered()).toBe(0);
  });
});
