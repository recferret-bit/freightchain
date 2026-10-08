import { RideEventPrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-event.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { RideEvent } from '../../../src/domain/live/ride-event.entity.js';
import { EFFECTS } from '../../../src/domain/live/live-rules.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, freeRideAt, inTx, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('RideEventPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: RideEventPrismaRepository, rides: RidePrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new RideEventPrismaRepository(prisma); rides = new RidePrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await seedPlayer(prisma, 'w'); });

  const started = async () => { const r = freeRideAt('w'); r.start(T0); await rides.insert(r); return r; };

  it('numbers the feed and round-trips every field (BigInt lamports, the stamp); listAfter pages by id', async () => {
    const ride = await started();
    const a = await repo.insert(RideEvent.message({ rideId: ride.id, wallet: 'fan', text: 'hello', now: T0 }));
    const b = await repo.insert(RideEvent.donation({ rideId: ride.id, wallet: 'fan', effect: 'sinkhole', note: 'enjoy', now: at(1) }));
    expect(a?.id).toBeGreaterThan(0); expect(b!.id!).toBeGreaterThan(a!.id!);
    expect(b?.snapshot()).toMatchObject({ kind: 'donation', effect: 'sinkhole', text: 'enjoy', lamports: EFFECTS.sinkhole.lamports, slotKey: 'fx', createdAt: at(1), applied: null });
    expect((await repo.listAfter(ride.id, 0, 10)).map((e) => e.kind)).toEqual(['message', 'donation']);
    expect((await repo.listAfter(ride.id, a!.id!, 10)).map((e) => e.id)).toEqual([b!.id]);
    expect(await repo.listAfter(ride.id, 0, 1)).toHaveLength(1);
    expect(await repo.findById(b!.id!)).toEqual(b);
    expect(await repo.findById(999_999)).toBeNull();
  });

  it('a taken rate-limit window is null (the unique key), a later window is fine', async () => {
    const ride = await started();
    expect(await repo.insert(RideEvent.donation({ rideId: ride.id, wallet: 'a', effect: 'night', now: T0 }))).not.toBeNull();
    expect(await repo.insert(RideEvent.donation({ rideId: ride.id, wallet: 'b', effect: 'trench', now: at(5) }))).toBeNull();
    expect(await repo.insert(RideEvent.donation({ rideId: ride.id, wallet: 'b', effect: 'trench', now: at(20) }))).not.toBeNull();
    expect(await repo.insert(RideEvent.message({ rideId: ride.id, wallet: 'a', text: 'x', now: at(21) }))).not.toBeNull();
    expect(await repo.insert(RideEvent.message({ rideId: ride.id, wallet: 'a', text: 'y', now: at(23) }))).toBeNull(); // same 3 s window (21–24)
    expect(await prisma.rideEvent.count()).toBe(3);
  });

  it('saveApplied: the first stamp wins, a second is false and changes nothing', async () => {
    const ride = await started();
    const stored = (await repo.insert(RideEvent.donation({ rideId: ride.id, wallet: 'fan', effect: 'potholes', now: T0 })))!;
    const first = (await repo.findById(stored.id!))!, second = (await repo.findById(stored.id!))!;
    first.markApplied({ t: 12.5, s: 1830, lat: -2.4 }, at(2));
    second.markApplied({ t: 99, s: 1, lat: 1 }, at(3));
    expect(await inTx(prisma, (tx) => repo.saveApplied(first, tx))).toBe(true);
    expect(await repo.saveApplied(second)).toBe(false);
    expect((await repo.findById(stored.id!))?.applied).toEqual({ at: at(2), t: 12.5, s: 1830, lat: -2.4 });
  });

  it('totals per ride (mock lamports summed), and the feed goes with its ride (cascade)', async () => {
    const ride = await started(), other = await started();
    await repo.insert(RideEvent.message({ rideId: ride.id, wallet: 'a', text: 'x', now: T0 }));
    await repo.insert(RideEvent.donation({ rideId: ride.id, wallet: 'a', effect: 'tip', now: T0 }));
    await repo.insert(RideEvent.donation({ rideId: ride.id, wallet: 'b', effect: 'day', now: T0 }));
    await repo.insert(RideEvent.message({ rideId: other.id, wallet: 'a', text: 'x', now: T0 }));
    expect(await repo.totals(ride.id)).toEqual({ messages: 1, donations: 2, lamports: EFFECTS.tip.lamports + EFFECTS.day.lamports });
    expect(await repo.totals('00000000-0000-4000-8000-ffffffffffff')).toEqual({ messages: 0, donations: 0, lamports: 0 });
    await prisma.ride.delete({ where: { id: ride.id } });
    expect(await prisma.rideEvent.count()).toBe(1);
  });
});
