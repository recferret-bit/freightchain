import { RidePrismaRepository } from '../../../src/infrastructure/prisma/repositories/ride.prisma.repository.js';
import { RideStatus } from '../../../src/domain/rides/ride-status.js';
import { VersionConflictError } from '../../../src/domain/shared/errors.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { T0, at, freeRideAt, orderAt, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('RidePrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: RidePrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new RidePrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => { await wipe(prisma); await seedPlayer(prisma, 'w'); });

  it('round-trips every field (BigInt lamports ⇄ number, dates, enums, nulls)', async () => {
    const order = orderAt('w', T0, 4_242_424_242);
    await repo.insert(order);
    expect((await repo.findById(order.id))?.snapshot()).toEqual(order.snapshot());
    const ride = freeRideAt('w');
    ride.start(T0);
    ride.applyReport({ s: 50, t: 3, hull: 80, paused: true, route: 'siberia', night: true }, at(3), { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 });
    await repo.insert(ride);
    expect((await repo.findById(ride.id))?.snapshot()).toEqual(ride.snapshot());
    expect(await repo.findById('00000000-0000-4000-8000-ffffffffffff')).toBeNull();
  });

  it('what a ride started with (wheel, truck colour, gearbox) is saved with the start and read back (null before it, and for rides that never had one)', async () => {
    const ride = freeRideAt('w');
    await repo.insert(ride);
    expect((await repo.findById(ride.id))?.loadout).toBeNull();
    const started = (await repo.findById(ride.id))!;
    started.start(at(1), { wheel: 'gold', truck_color: 'blue', gearbox: 'stick' });
    await repo.save(started);
    expect((await repo.findById(ride.id))?.loadout).toEqual({ wheel: 'gold', truck_color: 'blue', gearbox: 'stick' });
    expect((await repo.findById(ride.id))?.snapshot()).toEqual(started.snapshot().version === 1 ? { ...started.snapshot(), version: 2 } : started.snapshot());
  });

  it('save writes the mutable fields and bumps the version; a stale entity is a VersionConflictError', async () => {
    const ride = freeRideAt('w');
    await repo.insert(ride);
    const a = await repo.findById(ride.id), stale = await repo.findById(ride.id);
    a?.start(at(1));
    const saved = await repo.save(a!);
    expect(saved.version).toBe(2);
    expect((await repo.findById(ride.id))?.status).toBe(RideStatus.Running);
    stale?.cancelReplaced(at(2));
    await expect(repo.save(stale!)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('open rides: running first, then ready, then unpaid; newest first within a status, insertion order breaking equal timestamps', async () => {
    const order = orderAt('w', T0); await repo.insert(order);
    const free1 = freeRideAt('w', at(1)); await repo.insert(free1);
    const free2 = freeRideAt('w', at(1)); await repo.insert(free2); // same timestamp: the later insert is "newer"
    const done = freeRideAt('w', at(2)); done.start(at(2)); done.finish('failed', null, at(3)); await repo.insert(done);
    expect((await repo.listOpenByWallet('w')).map((r) => r.id)).toEqual([free2.id, free1.id, order.id]);
    const run = freeRideAt('w', at(0)); run.start(at(0)); await repo.insert(run);
    expect((await repo.findOpenByWallet('w'))?.id).toBe(run.id);
    expect(await repo.findOpenByWallet('nobody')).toBeNull();
  });

  it('pending paid: a paid unstarted ride first, then unpaid / lapsed orders created since the cut-off; never free rides', async () => {
    await repo.insert(freeRideAt('w'));
    const old = orderAt('w', T0); old.expire(at(1)); await repo.insert(old);
    expect((await repo.findPendingPaid('w', at(-1)))?.id).toBe(old.id);
    expect(await repo.findPendingPaid('w', at(1))).toBeNull(); // lapsed before the cut-off
    const paid = orderAt('w', at(5)); paid.markPaid(1, at(6));
    await prisma.round.create({ data: { id: 1, startsAt: T0, endsAt: at(1000), carry: 0n, status: 'open' } });
    await repo.insert(paid);
    const newer = orderAt('w', at(9)); await repo.insert(newer);
    expect((await repo.findPendingPaid('w', at(-1)))?.id).toBe(paid.id);
  });
});
