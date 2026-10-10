import { ListAdminPlayersHandler } from '../../../../../src/application/use-cases/admin/list-admin-players/list-admin-players.handler.js';
import { ListAdminPlayersQuery } from '../../../../../src/application/use-cases/admin/list-admin-players/list-admin-players.query.js';
import { addStats, EMPTY_STATS } from '../../../../../src/domain/stats/stats.js';
import { unitContext } from '../../../../support/unit-context.js';
import { poolProps } from '../../../../support/pools.js';

describe('ListAdminPlayersHandler', () => {
  it('newest first with balance, rides driven, unused tickets and the last sign-in; `q` is a wallet prefix; limit applies', async () => {
    const ctx = unitContext();
    await ctx.player('Alice1');
    ctx.clock.advance(60);
    await ctx.player('Bob2');
    await ctx.signIns.insert({ wallet: 'Alice1', at: ctx.now(), ip: null, userAgent: null });
    ctx.db.playerStats.set('Alice1', { totals: addStats(EMPTY_STATS, { ...EMPTY_STATS, rides: 4 }), updatedAt: ctx.now() });
    ctx.db.pools.set(1, poolProps());
    ctx.db.tickets.set('Alice1|1', { wallet: 'Alice1', poolId: 1, balance: 3, bought: 3, version: 1 });
    const h = new ListAdminPlayersHandler(ctx.adminDirectory);
    const { rows } = await h.execute(new ListAdminPlayersQuery(10));
    expect(rows.map((r) => r.wallet)).toEqual(['Bob2', 'Alice1']);
    expect(rows[1]).toMatchObject({ wallet: 'Alice1', freeRides: 10, freeRidesMax: 5, rides: 4, tickets: 3, lastSignInAt: ctx.clock.ms });
    expect(rows[0]).toMatchObject({ rides: 0, tickets: 0, lastSignInAt: null });
    expect((await h.execute(new ListAdminPlayersQuery(10, 'Ali'))).rows.map((r) => r.wallet)).toEqual(['Alice1']);
    expect((await h.execute(new ListAdminPlayersQuery(1))).rows).toHaveLength(1);
  });
});
