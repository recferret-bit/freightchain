import { StatsPrismaRepository } from '../../../src/infrastructure/prisma/repositories/stats.prisma.repository.js';
import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { RideEventPrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride-event.prisma.repository.js';
import { RideEvent } from '../../../src/domain/live/ride-event.entity.js';
import { EMPTY_STATS, rideDelta, type StatsTotals } from '../../../src/domain/stats/stats.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, freeRideAt, inTx, seedPlayer, testPrisma, wipe } from '../../support/db.js';

const d = (over: Partial<StatsTotals>): StatsTotals => ({ ...EMPTY_STATS, ...over });

describe('StatsPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: StatsPrismaRepository, rides: RidePrismaRepository, events: RideEventPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new StatsPrismaRepository(prisma); rides = new RidePrismaRepository(prisma); events = new RideEventPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await seedPlayer(prisma, 'a'); await seedPlayer(prisma, 'b'); });

  /** a started ride that ran and ended */
  const endedRide = async (wallet: string, status: 'completed' | 'failed' | 'abandoned' | 'running', metres: number, seconds: number, crashes: [number, number] = [0, 0]) => {
    const ride = freeRideAt(wallet);
    ride.start(T0);
    await rides.insert(ride);
    const p = ride.snapshot();
    await prisma.ride.update({ where: { id: p.id }, data: { status, lastS: metres, driveSeconds: seconds, crashesVehicle: crashes[0], crashesBuilding: crashes[1], endedAt: status === 'running' ? null : at(seconds) } });
    return ride;
  };

  it('add: creates the rider\'s row and the global row, then adds to both (rounded floats, BigInt lamports)', async () => {
    await repo.add('a', d({ rides: 1, ridesFree: 1, ridesCompleted: 1, seconds: 12.5, metres: 140.25, crashesVehicle: 2 }), at(1));
    await repo.add('a', d({ rides: 1, ridesPaid: 1, seconds: 7.5, metres: 9.75, crashesBuilding: 1, donations: 1, donationLamports: 5_000_000_000 }), at(2));
    await repo.add('b', d({ rides: 1, metres: 50 }), at(3));
    expect((await repo.findPlayer('a'))?.totals).toEqual({ rides: 2, ridesFree: 1, ridesPaid: 1, ridesCompleted: 1, seconds: 20, metres: 150, crashesVehicle: 2, crashesBuilding: 1, donations: 1, donationLamports: 5_000_000_000 });
    expect((await repo.findPlayer('a'))?.updatedAt).toEqual(at(2));
    expect((await repo.findGlobal())?.totals).toMatchObject({ rides: 3, metres: 200, donationLamports: 5_000_000_000 });
    expect(await repo.findPlayer('nobody')).toBeNull();
    expect(await repo.countDrivers()).toBe(2);
  });

  it('add inside a transaction rolls back with it: both rows or neither', async () => {
    await expect(inTx(prisma, async (tx) => { await repo.add('a', d({ rides: 1, metres: 10 }), at(1), tx); throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await repo.findPlayer('a')).toBeNull();
    expect(await repo.findGlobal()).toBeNull();
    await inTx(prisma, (tx) => repo.add('a', d({ rides: 1, metres: 10 }), at(1), tx));
    expect((await repo.findGlobal())?.totals.metres).toBe(10);
  });

  it('a donation-only rider is not a driver; the rider row goes with its player (cascade)', async () => {
    await repo.add('a', d({ donations: 1 }), at(1));
    expect(await repo.countDrivers()).toBe(0);
    await prisma.player.delete({ where: { wallet: 'a' } });
    expect(await repo.findPlayer('a')).toBeNull();
  });

  it('recompute: every started ride that ENDED, with crashes; running, never-started and cancelled rides do not count', async () => {
    await endedRide('a', 'failed', 800, 60, [2, 1]);
    await endedRide('a', 'completed', 5000, 300);
    const paid = await endedRide('b', 'abandoned', 100, 10);
    await prisma.ride.update({ where: { id: paid.id }, data: { tier: '1h' } });   // a paid ride
    await endedRide('b', 'running', 999, 99);
    await rides.insert(freeRideAt('b', at(5)));   // created, never started
    const truth = await repo.recompute();
    expect([...truth.keys()].sort()).toEqual(['a', 'b']);
    expect(truth.get('a')).toEqual({ rides: 2, ridesFree: 2, ridesPaid: 0, ridesCompleted: 1, seconds: 360, metres: 5800, crashesVehicle: 2, crashesBuilding: 1, donations: 0, donationLamports: 0 });
    expect(truth.get('b')).toMatchObject({ rides: 1, ridesFree: 0, ridesPaid: 1, ridesCompleted: 0, metres: 100 });
    expect([...(await repo.recompute('b')).keys()]).toEqual(['b']);
  });

  it('recompute: donations belong to the DRIVER; the lamports only when a transfer paid them', async () => {
    const ride = await endedRide('a', 'running', 10, 5);
    await events.insert(RideEvent.donation({ rideId: ride.id, wallet: 'b', effect: 'tip', now: at(1) }));
    await events.insert(RideEvent.donation({ rideId: ride.id, wallet: 'b', effect: 'tip', now: at(10), paid: { orderId: 'o1', signature: 'sig-1', lamports: 40_000 } }));
    await events.insert(RideEvent.message({ rideId: ride.id, wallet: 'b', text: 'hi', now: at(20) }));
    const truth = await repo.recompute();
    expect(truth.get('a')).toMatchObject({ rides: 0, donations: 2, donationLamports: 40_000 });
    expect(truth.has('b')).toBe(false);
  });

  it('what the entity sums to equals what the SQL sums to (rideDelta ⇄ recompute)', async () => {
    const ride = await endedRide('a', 'failed', 321.5, 42.25, [3, 0]);
    const fresh = await rides.findById(ride.id);
    const delta = rideDelta(fresh!.snapshot())!;
    expect((await repo.recompute()).get('a')).toEqual(delta);
  });

  it('replace: rows become exactly the truth (a row with nothing behind it is deleted), the global row the sum of all riders; a scoped replace touches one rider', async () => {
    await repo.add('a', d({ rides: 9, metres: 9 }), at(1));
    await repo.add('b', d({ rides: 5, metres: 5 }), at(1));
    await endedRide('a', 'failed', 800, 60);
    await repo.replace(await repo.recompute(), at(9), null);
    expect((await repo.listPlayers()).get('a')).toMatchObject({ rides: 1, metres: 800 });
    expect((await repo.listPlayers()).has('b')).toBe(false);
    expect((await repo.findGlobal())?.totals).toMatchObject({ rides: 1, metres: 800 });
    await repo.add('b', d({ rides: 4, metres: 4 }), at(10));
    await repo.replace(await repo.recompute('b'), at(11), 'b');
    expect((await repo.listPlayers()).has('b')).toBe(false);
    expect((await repo.listPlayers('a')).get('a')).toMatchObject({ rides: 1 });
    expect((await repo.findGlobal())?.totals).toMatchObject({ rides: 1, metres: 800 });
  });
});
