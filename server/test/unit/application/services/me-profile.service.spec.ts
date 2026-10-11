import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { DEMO_UNIT_WALLET, unitContext } from '../../../support/unit-context.js';
import { aPool } from '../../../support/pools.js';

/* The one profile answer of GET /api/me and the sign-in: the touched player + its ticket balances + the ready free ride. */
describe('MeProfileService', () => {
  it('the player as the caller touched it, its tickets, the demo flag and no ready ride', async () => {
    const ctx = unitContext();
    const now = ctx.now(), player = await ctx.sessions.touch('w', now);
    await ctx.pools.upsert(aPool({ id: 1, status: 'active', label: 'L1' }));
    const t = await ctx.tickets.open('w', 1); t.recordPurchase(2); await ctx.tickets.save(t);
    expect(await ctx.meProfile.of(player, now)).toMatchObject({ wallet: 'w', freeRides: 10, demo: false, createdAt: now.getTime(), readyFreeRide: null, tickets: [{ poolId: 1, balance: 2 }] });
    expect(await ctx.meProfile.of(await ctx.sessions.touch(DEMO_UNIT_WALLET, now), now)).toMatchObject({ demo: true, demoScale: 60 });
  });

  it('readyFreeRide: the wallet\'s free ride ordered but not started; none once it runs, and a paid order is never one', async () => {
    const ctx = unitContext();
    const now = ctx.now(), player = await ctx.sessions.touch('w', now);
    const ride = Ride.createFree({ id: 'r1', wallet: 'w', seed: 7, minSeconds: 300, now, level: 3 });
    await ctx.rides.insert(ride);
    expect((await ctx.meProfile.of(player, now)).readyFreeRide).toEqual({ id: 'r1', level: 3, trip: 'free-3b', tutorial: false, assist: false });
    ride.start(now); await ctx.rides.save(ride);
    expect((await ctx.meProfile.of(player, now)).readyFreeRide).toBeNull();
    await ctx.paidOrder('payer');
    expect((await ctx.meProfile.of(await ctx.storedPlayer('payer'), now)).readyFreeRide).toBeNull();
  });

  it('attaches primary .sol domain to MeDto when registered', async () => {
    const ctx = unitContext();
    const now = ctx.now(), player = await ctx.sessions.touch('w', now);
    ctx.nameService.setReverse('w', 'driver.sol');
    const me = await ctx.meProfile.of(player, now);
    expect(me.sns).toBe('driver.sol');
  });
});
