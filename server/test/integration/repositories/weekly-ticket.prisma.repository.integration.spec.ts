import { WeeklyTicketPrismaRepository } from '../../../src/infrastructure/prisma/repositories/weekly-ticket.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, inTx, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('WeeklyTicketPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: WeeklyTicketPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new WeeklyTicketPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('inserts one row per wallet per week, keeps the first tier, and spends it once', async () => {
    await seedPlayer(prisma, 'w');
    const expires = new Date('2036-10-12T12:00:00.000Z');
    const row = { wallet: 'w', weekId: '2036-10-06', tier: '1h' as const, expiresAt: expires, now: T0 };
    await repo.ensure(row);
    await repo.ensure({ ...row, tier: '4h' });
    expect(await repo.current('w', T0)).toMatchObject({ tier: '1h', rideId: null, weekId: '2036-10-06' });
    expect(await inTx(prisma, (tx) => repo.claim('w', '1h', 'ride-1', T0, tx))).toBe(true);
    expect(await repo.current('w', T0)).toBeNull();
    expect(await inTx(prisma, (tx) => repo.claim('w', '1h', 'ride-2', T0, tx))).toBe(false);
  });
});
