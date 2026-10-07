import { ChallengePrismaRepository } from '../../../src/infrastructure/prisma/repositories/challenge.prisma.repository.js';
import { AuthChallenge } from '../../../src/domain/auth/auth-challenge.entity.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, testPrisma, wipe } from '../../support/db.js';

const issue = (nonce: string) => AuthChallenge.issue({ wallet: 'w', domain: 'd', origin: 'o', nonce, now: T0, ttlMs: 300_000 });

describe('ChallengePrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: ChallengePrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new ChallengePrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('one pending challenge per wallet: upsert replaces it', async () => {
    await repo.upsert(issue('one'));
    await repo.upsert(issue('two'));
    const got = await repo.consume('w');
    expect(got?.message).toContain('Nonce: two');
    expect(got?.expiresAt).toEqual(new Date(T0.getTime() + 300_000));
  });

  it('consume is single use – and atomic: of many concurrent consumers exactly one gets it', async () => {
    await repo.upsert(issue('x'));
    const results = await Promise.all(Array.from({ length: 8 }, () => repo.consume('w')));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await repo.consume('w')).toBeNull();
  });
});
