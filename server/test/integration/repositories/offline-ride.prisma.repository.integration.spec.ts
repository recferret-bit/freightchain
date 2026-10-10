import { OfflineRidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/offline-ride.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, testPrisma, wipe } from '../../support/db.js';

const FP = 'a'.repeat(64);
const FP2 = 'b'.repeat(64);

describe('OfflineRidePrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: OfflineRidePrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new OfflineRidePrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('grants until the fingerprint limit, then refuses without another row', async () => {
    expect(await repo.counts(FP, '1.1.1.1')).toEqual({ usedFingerprint: 0, usedIp: 0 });
    expect(await repo.tryClaim({ id: '1', fingerprint: FP, ip: '1.1.1.1', at: T0, limitFingerprint: 2, limitIp: 10 })).toEqual({ granted: true, usedFingerprint: 1, usedIp: 1 });
    await repo.tryClaim({ id: '2', fingerprint: FP, ip: '1.1.1.1', at: T0, limitFingerprint: 2, limitIp: 10 });
    expect((await repo.tryClaim({ id: '3', fingerprint: FP, ip: '1.1.1.1', at: T0, limitFingerprint: 2, limitIp: 10 })).granted).toBe(false);
    expect(await prisma.offlineRideUse.count()).toBe(2);
  });

  it('two fingerprints behind one address stop at the IP limit', async () => {
    expect((await repo.tryClaim({ id: 'a', fingerprint: FP, ip: '8.8.8.8', at: T0, limitFingerprint: 3, limitIp: 1 })).granted).toBe(true);
    const second = await repo.tryClaim({ id: 'b', fingerprint: FP2, ip: '8.8.8.8', at: T0, limitFingerprint: 3, limitIp: 1 });
    expect(second).toEqual({ granted: false, usedFingerprint: 0, usedIp: 1 });
    expect(await prisma.offlineRideUse.count()).toBe(1);
  });

  it('the last fingerprint slot is taken by exactly one of two racing claims', async () => {
    const [a, b] = await Promise.all([
      repo.tryClaim({ id: 'race-a', fingerprint: FP, ip: '9.9.9.9', at: T0, limitFingerprint: 1, limitIp: 10 }),
      repo.tryClaim({ id: 'race-b', fingerprint: FP, ip: '9.9.9.9', at: T0, limitFingerprint: 1, limitIp: 10 }),
    ]);
    expect([a, b].filter((r) => r.granted)).toHaveLength(1);
    expect(await prisma.offlineRideUse.count({ where: { fingerprint: FP } })).toBe(1);
  });
});
