import { RideMiniGame } from '../../../src/domain/minigames/ride-minigame.js';
import { RideMiniGamePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-minigame.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, freeRideAt, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('RideMiniGamePrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: RideMiniGamePrismaRepository, rides: RidePrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new RideMiniGamePrismaRepository(prisma); rides = new RidePrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await seedPlayer(prisma, 'w'); });

  it('a second insert of the same ordinal does not overwrite, and the rows leave with the ride', async () => {
    const ride = freeRideAt('w');
    await rides.insert(ride);
    const armed = RideMiniGame.arm({ id: 'ev1', rideId: ride.id, ordinal: 0, kind: 'phone-sms', trigger: 'stop', armedAtMs: 300_000, bayDeadlineMs: 1_000, windowMs: 30_000, answerHash: 'h' });
    expect((await repo.insert(armed)).status).toBe('armed');
    armed.reveal(0, 'nonce', 'h', 30_000, true, T0);
    await repo.save(armed);
    const raced = RideMiniGame.arm({ id: 'ev2', rideId: ride.id, ordinal: 0, kind: 'phone-sms', trigger: 'stop', armedAtMs: 1, bayDeadlineMs: 1, windowMs: 1, answerHash: 'other' });
    const kept = await repo.insert(raced);
    expect(kept.id).toBe('ev1');
    expect(kept.status).toBe('revealed');
    expect(kept.nonce).toBe('nonce');
    expect((await repo.listByRide(ride.id)).map((row) => row.id)).toEqual(['ev1']);
    await prisma.ride.delete({ where: { id: ride.id } });
    expect(await prisma.rideMiniGame.count()).toBe(0);
  });
});
