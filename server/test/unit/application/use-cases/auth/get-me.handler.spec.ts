import { GetMeHandler } from '../../../../../src/application/use-cases/auth/get-me/get-me.handler.js';
import { GetMeQuery } from '../../../../../src/application/use-cases/auth/get-me/get-me.query.js';
import { DEMO_UNIT_WALLET, unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

describe('GetMeHandler', () => {
  it('returns the profile, applying the lazy daily grant once per UTC day', async () => {
    const ctx = unitContext();
    const handler = new GetMeHandler(ctx.sessions, ctx.clock, ctx.meProfile);
    expect(await handler.execute(new GetMeQuery('w'))).toMatchObject({ wallet: 'w', freeRides: 10, demo: false, createdAt: ctx.clock.ms });
    ctx.clock.advance(86_400);
    expect((await handler.execute(new GetMeQuery('w'))).freeRides).toBe(10); // signup sits above the daily cap: nothing to add
    expect((await handler.execute(new GetMeQuery('w'))).freeRides).toBe(10);
  });

  it('says how many credits fit and when the next one arrives (null at the cap)', async () => {
    const ctx = unitContext();
    const handler = new GetMeHandler(ctx.sessions, ctx.clock, ctx.meProfile);
    expect(await handler.execute(new GetMeQuery('w'))).toMatchObject({ freeRides: 10, freeRidesMax: 5, nextFreeRideAt: null });
    const p = await ctx.storedPlayer('w');
    for (let i = 0; i < 6; i++) p.spendFreeRide(); // 10 → 4, under the daily cap
    await ctx.players.save(p);
    expect(await handler.execute(new GetMeQuery('w'))).toMatchObject({ freeRides: 4, freeRidesMax: 5, nextFreeRideAt: Date.UTC(2036, 9, 9) });
  });

  it('says whether the tutorial was done (a ride started with it on)', async () => {
    const ctx = unitContext();
    const handler = new GetMeHandler(ctx.sessions, ctx.clock, ctx.meProfile);
    expect(await handler.execute(new GetMeQuery('w'))).toMatchObject({ tutorialPassed: false });
    const p = await ctx.storedPlayer('w');
    p.markTutorialPassed(ctx.now());
    await ctx.players.save(p);
    expect(await handler.execute(new GetMeQuery('w'))).toMatchObject({ tutorialPassed: true });
  });

  it('lists the wallet\'s tickets per pool: held ones, and empty rows only while the pool is live', async () => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool({ id: 1, status: 'active', label: 'L1' }));
    await ctx.pools.upsert(aPool({ id: 2, status: 'refunding' }));
    await ctx.pools.upsert(aPool({ id: 3, status: 'settled' }));
    for (const [id, n] of [[1, 2], [2, 0], [3, 1]] as const) { const t = await ctx.tickets.open('w', id); if (n) { t.recordPurchase(n); await ctx.tickets.save(t); } }
    const rideBy = aPool().snapshot().playDeadline.getTime() - 3600_000;   // the last start of a 1 h shift that ends by the play deadline
    expect((await new GetMeHandler(ctx.sessions, ctx.clock, ctx.meProfile).execute(new GetMeQuery('w'))).tickets).toEqual([
      { poolId: 1, tier: '1h', label: 'L1', status: 'active', balance: 2, bought: 2, cap: 5, refundable: false, ridable: true, rideBy },
      { poolId: 3, tier: '1h', label: '1 HOUR · test', status: 'settled', balance: 1, bought: 1, cap: 5, refundable: false, ridable: false, rideBy },
    ]);
  });

  it('flags a demo wallet', async () => {
    const ctx = unitContext();
    expect(await new GetMeHandler(ctx.sessions, ctx.clock, ctx.meProfile).execute(new GetMeQuery(DEMO_UNIT_WALLET))).toMatchObject({ demo: true, demoScale: 60 });
  });
  it('readyFreeRide: the free ride ordered but not started – its id, level, trip and helpers; gone once it starts; a paid order is not one', async () => {
    const ctx = unitContext();
    const handler = new GetMeHandler(ctx.sessions, ctx.clock, ctx.meProfile);
    expect((await handler.execute(new GetMeQuery('w'))).readyFreeRide).toBeNull();
    const { Ride } = await import('../../../../../src/domain/rides/ride.entity.js');
    const ride = Ride.createFree({ id: 'r1', wallet: 'w', seed: 7, minSeconds: 100, now: ctx.now(), level: 2, tutorial: true, assist: true });
    await ctx.rides.insert(ride);
    const p = await ctx.storedPlayer('w');
    while (p.freeRides > 0) p.spendFreeRide();
    await ctx.players.save(p);
    expect(await handler.execute(new GetMeQuery('w'))).toMatchObject({ freeRides: 0, readyFreeRide: { id: 'r1', level: 2, trip: 'free-2c', tutorial: true, assist: true } });
    ride.start(ctx.now()); await ctx.rides.save(ride);
    expect((await handler.execute(new GetMeQuery('w'))).readyFreeRide).toBeNull();
    await ctx.paidOrder('payer');
    expect((await handler.execute(new GetMeQuery('payer'))).readyFreeRide).toBeNull();
  });
});
