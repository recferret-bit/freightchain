import { WeeklyTicketPrismaRepository } from '../../../src/infrastructure/prisma/repositories/weekly-ticket.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, inTx, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('WeeklyTicketPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: WeeklyTicketPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new WeeklyTicketPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('inserts one row per wallet, tier and period, and spends that tier once', async () => {
    await seedPlayer(prisma, 'w');
    const period = new Date('2036-10-06T00:00:00.000Z');
    const expires = new Date('2036-10-12T12:00:00.000Z');
    const row = { wallet: 'w', weekId: '2036-10-06', tier: '1h' as const, periodStart: period, expiresAt: expires, now: T0 };
    await repo.ensure(row);
    await repo.ensure({ ...row, expiresAt: new Date('2036-10-13T00:00:00.000Z') });
    await repo.ensure({ ...row, tier: '4h' });
    expect((await repo.live('w', T0)).map((r) => r.tier)).toEqual(['1h', '4h']);
    expect(await repo.hasPeriod('w', '1h', period)).toBe(true);
    expect(await inTx(prisma, (tx) => repo.claim('w', '1h', 'ride-1', T0, tx))).toBe(true);
    expect((await repo.live('w', T0)).map((r) => r.tier)).toEqual(['4h']);
    expect(await inTx(prisma, (tx) => repo.claim('w', '1h', 'ride-2', T0, tx))).toBe(false);
  });
});
