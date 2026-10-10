import { GetMeHandler } from '../../../../../src/application/use-cases/auth/get-me/get-me.handler.js';
import { GetMeQuery } from '../../../../../src/application/use-cases/auth/get-me/get-me.query.js';
import { DEMO_UNIT_WALLET, unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

describe('GetMeHandler', () => {
  it('returns the profile, applying the lazy daily grant once per UTC day', async () => {
    const ctx = unitContext();
    const handler = new GetMeHandler(ctx.sessions, ctx.rules, ctx.clock, ctx.poolTickets);
    expect(await handler.execute(new GetMeQuery('w'))).toMatchObject({ wallet: 'w', freeRides: 5, demo: false, createdAt: ctx.clock.ms });
    ctx.clock.advance(86_400);
    expect((await handler.execute(new GetMeQuery('w'))).freeRides).toBe(5); // already at the cap: nothing to add
    expect((await handler.execute(new GetMeQuery('w'))).freeRides).toBe(5);
  });

  it('says how many credits fit and when the next one arrives (null at the cap)', async () => {
    const ctx = unitContext();
    const handler = new GetMeHandler(ctx.sessions, ctx.rules, ctx.clock, ctx.poolTickets);
    expect(await handler.execute(new GetMeQuery('w'))).toMatchObject({ freeRides: 5, freeRidesMax: 5, nextFreeRideAt: null });
    const p = await ctx.storedPlayer('w');
    p.spendFreeRide();
    await ctx.players.save(p);
    expect(await handler.execute(new GetMeQuery('w'))).toMatchObject({ freeRides: 4, freeRidesMax: 5, nextFreeRideAt: Date.UTC(2036, 9, 9) });
  });

  it('says whether the tutorial was done (a ride started with it on)', async () => {
    const ctx = unitContext();
    const handler = new GetMeHandler(ctx.sessions, ctx.rules, ctx.clock, ctx.poolTickets);
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
    expect((await new GetMeHandler(ctx.sessions, ctx.rules, ctx.clock, ctx.poolTickets).execute(new GetMeQuery('w'))).tickets).toEqual([
      { poolId: 1, tier: '1h', label: 'L1', status: 'active', balance: 2, bought: 2, cap: 5, refundable: false },
      { poolId: 3, tier: '1h', label: '1 HOUR · test', status: 'settled', balance: 1, bought: 1, cap: 5, refundable: false },
    ]);
  });

  it('flags a demo wallet', async () => {
    const ctx = unitContext();
    expect(await new GetMeHandler(ctx.sessions, ctx.rules, ctx.clock, ctx.poolTickets).execute(new GetMeQuery(DEMO_UNIT_WALLET))).toMatchObject({ demo: true, demoScale: 60 });
  });
});
