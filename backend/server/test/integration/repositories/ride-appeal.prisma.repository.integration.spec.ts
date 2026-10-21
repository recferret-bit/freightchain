import { RideAppealPrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-appeal.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { PoolPrismaRepository } from '../../../src/infrastructure/prisma/repositories/pool.prisma.repository.js';
import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../src/domain/rides/ride-status.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, seedPlayer, testPrisma, wipe } from '../../support/db.js';
import { aPool } from '../../support/pools.js';

describe('RideAppealPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, appeals: RideAppealPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); appeals = new RideAppealPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('one open appeal blocks commit until it is denied', async () => {
    await seedPlayer(prisma, 'rider');
    await new PoolPrismaRepository(prisma).upsert(aPool({ id: 3, status: 'active' }, T0));
    const ride = Ride.createFromTicket({ id: '00000000-0000-4000-8000-000000000099', wallet: 'rider', tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, poolId: 3, roundId: 1, now: T0 });
    await new RidePrismaRepository(prisma).insert(Ride.restore({ ...ride.snapshot(), status: RideStatus.Completed, endedAt: T0, roundId: null }));
    await prisma.ride.update({ where: { id: ride.id }, data: { status: 'running' } });
    expect(await appeals.blockers(3)).toEqual({ openAppeals: 0, running: 1 });
    await prisma.ride.update({ where: { id: ride.id }, data: { status: 'completed' } });
    const row = { id: 'appeal-1', rideId: ride.id, wallet: 'rider', poolId: 3, reason: 'please look', status: 'open' as const, createdAt: T0, resolvedAt: null, resolvedBy: null, resolution: null };
    await appeals.insert(row);
    expect(await appeals.blockers(3)).toEqual({ openAppeals: 1, running: 0 });
    await appeals.save({ ...row, status: 'denied', resolvedAt: T0, resolvedBy: 'admin' });
    expect(await appeals.listOpen(3)).toEqual([]);
    expect((await appeals.findByRide(ride.id))?.status).toBe('denied');
  });
});
