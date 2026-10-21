import { GetAdminPlayerHandler } from '../../../../../src/application/use-cases/admin/get-admin-player/get-admin-player.handler.js';
import { GetAdminPlayerQuery } from '../../../../../src/application/use-cases/admin/get-admin-player/get-admin-player.query.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { EMPTY_STATS } from '../../../../../src/domain/stats/stats.js';
import { Payment } from '../../../../../src/domain/economy/payment.entity.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetAdminPlayerHandler', () => {
  const handler = (ctx: ReturnType<typeof unitContext>) => new GetAdminPlayerHandler(ctx.players, ctx.statsRepo, ctx.tickets, ctx.payments, ctx.signIns, ctx.adminQuery);

  it('a wallet detail read is an audit row', async () => {
    const ctx = unitContext();
    await ctx.freeRide('alice', true);
    const h = new GetAdminPlayerHandler(ctx.players, ctx.statsRepo, ctx.tickets, ctx.payments, ctx.signIns, ctx.adminQuery, ctx.adminActions, ctx.clock);
    await h.execute(new GetAdminPlayerQuery('alice', 'ADMIN'));
    expect(ctx.db.adminActions.at(-1)).toMatchObject({ action: 'read.player', target: 'alice', wallet: 'ADMIN', role: 'admin' });
  });

  it('a wallet that never signed in is a 404', async () => {
    await expect(handler(unitContext()).execute(new GetAdminPlayerQuery('nobody'))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('one rider: balances, statistics (rounded), tickets, the ledger, payments, the latest sign-ins and rides', async () => {
    const ctx = unitContext();
    await ctx.freeRide('alice', true);
    await ctx.signIns.insert({ wallet: 'alice', at: ctx.now(), ip: '1.1.1.1', userAgent: 'Safari' });
    ctx.db.playerStats.set('alice', { totals: { ...EMPTY_STATS, rides: 2, ridesFree: 2, seconds: 10.4, metres: 140.6 }, updatedAt: ctx.now() });
    await ctx.tickets.appendGrant({ wallet: 'alice', poolId: 1, delta: 2, source: 'promo', ref: 'WELCOME', at: ctx.now() });
    const d = await handler(ctx).execute(new GetAdminPlayerQuery('alice'));
    expect(d.player).toMatchObject({ wallet: 'alice', freeRides: 10, freeRidesMax: 5, tutorialPassedAt: null, age18At: null, lossAt: null, createdAt: ctx.clock.ms });
    expect(d.stats).toMatchObject({ rides: 2, seconds: 10, metres: 141 });
    expect(d.grants).toEqual([{ poolId: 1, delta: 2, source: 'promo', ref: 'WELCOME', at: ctx.clock.ms }]);
    expect(d.payments).toEqual({ count: 0, lamports: 0 });
    expect(d.signIns).toEqual([{ wallet: 'alice', at: ctx.clock.ms, ip: '1.1.1.1', userAgent: 'Safari' }]);
    expect(d.rides).toHaveLength(1);
    expect(d.rides[0]).toMatchObject({ wallet: 'alice', tier: 'free', status: 'running' });
    expect((await handler(ctx).execute(new GetAdminPlayerQuery('alice'))).tickets).toEqual([]);
  });

  it('a rider with no finished ride has stats null', async () => {
    const ctx = unitContext();
    await ctx.player('bob');
    expect((await handler(ctx).execute(new GetAdminPlayerQuery('bob'))).stats).toBeNull();
  });

  it('payments are summed over the wallet; sign-ins, rides and ledger lines are capped at the newest 10', async () => {
    const ctx = unitContext();
    await ctx.player('carol');
    await ctx.payments.insert(new Payment({ signature: 's1', rideId: 'r1', wallet: 'carol', lamports: 1000, usd: 1, roundId: 1, at: ctx.now() }));
    await ctx.payments.insert(new Payment({ signature: 's2', rideId: 'r2', wallet: 'carol', lamports: 2500, usd: 2, roundId: 1, at: ctx.now() }));
    for (let i = 0; i < 12; i++) { ctx.clock.advance(1); await ctx.signIns.insert({ wallet: 'carol', at: ctx.now(), ip: null, userAgent: null }); await ctx.tickets.appendGrant({ wallet: 'carol', poolId: 1, delta: 1, source: 'promo', ref: null, at: ctx.now() }); }
    const d = await handler(ctx).execute(new GetAdminPlayerQuery('carol'));
    expect(d.payments).toEqual({ count: 2, lamports: 3500 });
    expect(d.signIns).toHaveLength(10);
    expect(d.signIns[0]!.at).toBe(ctx.clock.ms);
    expect(d.grants).toHaveLength(10);
  });
});
