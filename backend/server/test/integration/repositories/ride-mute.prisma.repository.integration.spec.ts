import { RideMutePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-mute.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, freeRideAt, inTx, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('RideMutePrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: RideMutePrismaRepository, rides: RidePrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new RideMutePrismaRepository(prisma); rides = new RidePrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await seedPlayer(prisma, 'w'); });

  it('mute / unmute is idempotent, per ride, in or out of a transaction; mutes go with their ride', async () => {
    const a = freeRideAt('w'), b = freeRideAt('w'); await rides.insert(a); await rides.insert(b);
    expect(await repo.set(a.id, 'troll', true, T0)).toBe(true);
    expect(await inTx(prisma, (tx) => repo.set(a.id, 'troll', true, T0, tx))).toBe(false);
    await repo.set(a.id, 'other', true, T0);
    expect([...(await repo.list(a.id))].sort()).toEqual(['other', 'troll']);
    expect(await repo.isMuted(b.id, 'troll')).toBe(false);
    expect(await repo.set(a.id, 'troll', false, T0)).toBe(true);
    expect(await repo.set(a.id, 'troll', false, T0)).toBe(false);
    expect(await repo.isMuted(a.id, 'troll')).toBe(false);
    await prisma.ride.delete({ where: { id: a.id } });
    expect(await prisma.rideMute.count()).toBe(0);
  });
});
