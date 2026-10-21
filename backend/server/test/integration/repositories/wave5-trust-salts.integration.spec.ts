import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { inpPrunable } from '../../../src/domain/anticheat/inp-retention.js';
import { at, seedPlayer, testPrisma, wipe } from '../../support/db.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';

describe('wave 5 salt, trust, and inp rows', () => {
  let prisma: PrismaService;
  beforeAll(async () => { prisma = await testPrisma(); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('a new player starts at trust 60 and an enforce start stores salts that the retention rule can see', async () => {
    await seedPlayer(prisma, 'w');
    const trust = await prisma.$queryRaw<{ trustScore: number }[]>`SELECT "trustScore" FROM "player"."Player" WHERE wallet = 'w'`;
    expect(trust[0]?.trustScore).toBe(60);
    const id = '00000000-0000-4000-8000-0000000000a1';
    await prisma.ride.create({ data: { id, wallet: 'w', tier: '1h', seed: 1, minSeconds: 3600, completeDist: 1, status: 'running', createdAt: at(0) } });
    await new RidePrismaRepository(prisma).storeRevealedSalts(id, { trafficSalt: 'abc', holeSalt: 'def', saltCommit: 'ghi' });
    const salts = await prisma.$queryRaw<{ trafficSalt: string; holeSalt: string; saltCommit: string }[]>`SELECT "trafficSalt", "holeSalt", "saltCommit" FROM "ride"."Ride" WHERE id = ${id}`;
    expect(salts[0]).toEqual({ trafficSalt: 'abc', holeSalt: 'def', saltCommit: 'ghi' });
    await prisma.$executeRaw`UPDATE "telemetry"."RideBatch" SET "inp" = NULL WHERE false`;
    const old = new Date('2026-01-01T00:00:00Z');
    expect(inpPrunable({ rideId: id, inpAt: old, payoutFinalizedAt: new Date('2026-06-01T00:00:00Z') }, new Date('2026-06-02T00:00:00Z'))).toBe(true);
  });
});
