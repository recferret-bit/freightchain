import { SponsoredTxPrismaRepository } from '../../../src/infrastructure/prisma/repositories/sponsored-tx.prisma.repository.js';
import type { SponsoredTxRow } from '../../../src/application/ports/economy/sponsored-tx.repository.port.js';
import { startOfUtcDay } from '../../../src/domain/shared/time.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, inTx, testPrisma, wipe } from '../../support/db.js';

const tx = (signature: string, over: Partial<SponsoredTxRow> = {}): SponsoredTxRow => ({ signature, wallet: 'w1', kind: 'buy', feeLamports: 10_360, at: T0, ...over });

describe('SponsoredTxPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: SponsoredTxPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new SponsoredTxPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('records a sponsored transaction once per signature (a duplicate is skipped, false)', async () => {
    expect(await repo.record(tx('s1'))).toBe(true);
    expect(await repo.record(tx('s1', { wallet: 'w2' }))).toBe(false);
    const rows = await prisma.sponsoredTx.findMany();
    expect(rows).toEqual([{ signature: 's1', wallet: 'w1', kind: 'buy', feeLamports: 10_360n, at: T0 }]);
  });

  it('a duplicate inside a transaction does not abort it', async () => {
    await repo.record(tx('s1'));
    await inTx(prisma, async (h) => {
      expect(await repo.record(tx('s1'), h)).toBe(false);
      expect(await repo.record(tx('s2'), h)).toBe(true);
    });
    expect(await prisma.sponsoredTx.count()).toBe(2);
  });

  it('countSince: this wallet\'s sponsored transactions of the UTC day (the daily cap)', async () => {
    const day = startOfUtcDay(T0); // T0 is noon UTC
    await repo.record(tx('yesterday', { at: new Date(day.getTime() - 1) }));
    await repo.record(tx('midnight', { at: day }));
    await repo.record(tx('noon', { at: T0, kind: 'refund' }));
    await repo.record(tx('later', { at: at(3600) }));
    await repo.record(tx('other wallet', { wallet: 'w2' }));
    expect(await repo.countSince('w1', day)).toBe(3);
    expect(await repo.countSince('w1', T0)).toBe(2);
    expect(await repo.countSince('w2', day)).toBe(1);
    expect(await repo.countSince('nobody', day)).toBe(0);
    expect(day.toISOString()).toBe('2036-10-08T00:00:00.000Z');
  });
});
