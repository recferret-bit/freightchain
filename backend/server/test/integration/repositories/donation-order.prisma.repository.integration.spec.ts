import { DonationOrderPrismaRepository } from '../../../src/infrastructure/prisma/repositories/donation-order.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { DonationOrder } from '../../../src/domain/live/donation-order.entity.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, freeRideAt, rideId, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('DonationOrderPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: DonationOrderPrismaRepository, rides: RidePrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new DonationOrderPrismaRepository(prisma); rides = new RidePrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await seedPlayer(prisma, 'w'); });

  const make = async (id = rideId()) => { const r = freeRideAt('w'); await rides.insert(r); const o = DonationOrder.create({ id, rideId: r.id, wallet: 'fan', recipient: 'w', effect: 'sinkhole', note: 'gg', now: T0 }); await repo.insert(o); return o; };

  it('round-trips an order (BigInt lamports), claims it once, refuses a transfer that already paid another order, records its event', async () => {
    const o = await make(), other = await make();
    expect((await repo.findById(o.id))?.snapshot()).toEqual(o.snapshot());
    expect(await repo.findById('00000000-0000-4000-8000-ffffffffffff')).toBeNull();
    expect(await repo.claim(o.id, 'sig-1', at(5))).toBe(true);
    expect(await repo.claim(o.id, 'sig-1', at(6))).toBe(false);   // already paid
    expect(await repo.claim(other.id, 'sig-1', at(6))).toBe(false);   // the signature is unique
    expect((await repo.findById(other.id))?.status).toBe('pending');
    await repo.setEvent(o.id, 42);
    expect((await repo.findById(o.id))?.snapshot()).toMatchObject({ status: 'paid', signature: 'sig-1', paidAt: at(5), eventId: 42 });
    const race = await Promise.all(Array.from({ length: 6 }, (_, i) => repo.claim(other.id, `sig-r${i}`, at(7))));
    expect(race.filter(Boolean)).toHaveLength(1);
  });
});
