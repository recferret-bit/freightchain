import { ReferralPrismaRepository } from '../../../src/infrastructure/prisma/repositories/referral.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { seedPlayer, T0, testPrisma, wipe } from '../../support/db.js';

const HOST = 'HostWa11et11111111111111111111111111111111';
const FRIEND = 'FriendWa11et111111111111111111111111111111';
const EDGE = 'EdgeWa11et1111111111111111111111111111111';

describe('ReferralPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: ReferralPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new ReferralPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  const code = { wallet: HOST, code: 'ABCD2345', gift: 'convoy', createdAt: T0 };
  const pending = {
    referee: FRIEND, referrer: HOST, status: 'pending' as const, boundAt: T0, expiresAt: new Date(T0.getTime() - 1000),
    qualifiedAt: null, rideId: null, freeGranted: false, badgeCounted: false,
  };

  it('one code per wallet, one referrer per friend; a clash returns false and the next call still works', async () => {
    await seedPlayer(prisma, HOST); await seedPlayer(prisma, FRIEND);
    expect(await repo.insertCode(code)).toBe(true);
    expect(await repo.insertCode(code)).toBe(false);
    expect(await repo.insertCode({ ...code, wallet: FRIEND })).toBe(false); // the code is taken
    expect((await repo.codeByCode('ABCD2345'))?.wallet).toBe(HOST);
    expect(await repo.insertReferral(pending)).toBe(true);
    expect(await repo.insertReferral(pending)).toBe(false);
    expect(await repo.expireDue(HOST, T0)).toBe(1);
    expect((await repo.referralOf(FRIEND))?.status).toBe('expired');
    await seedPlayer(prisma, EDGE);
    await repo.insertReferral({ ...pending, referee: EDGE, expiresAt: T0 });
    expect(await repo.expireDue(HOST, T0)).toBe(0); // exactly expiresAt is still live
    expect((await repo.referralOf(EDGE))?.status).toBe('pending');
    expect(await repo.expireDue(HOST, new Date(T0.getTime() + 1))).toBe(1);
    await repo.saveReferral({ ...pending, status: 'qualified', qualifiedAt: T0, badgeCounted: true });
    expect((await repo.referralOf(FRIEND))?.badgeCounted).toBe(true);
    expect(await repo.weeklyFreeGrants(HOST, T0)).toBe(0);
    expect(await repo.hasStartedRide(FRIEND)).toBe(false);
    expect(await repo.verifiedPaidShifts(HOST)).toBe(0);
    await repo.setGift(HOST, 'amber');
    expect((await repo.codeByWallet(HOST))?.gift).toBe('amber');
  });
});
