import type { QueryBus } from '@nestjs/cqrs';
import { ListAdminPoolsHandler } from '../../../../../src/application/use-cases/admin/list-admin-pools/list-admin-pools.handler.js';
import { GetPoolStandingsHandler } from '../../../../../src/application/use-cases/pools/get-pool-standings/get-pool-standings.handler.js';
import type { GetPoolStandingsQuery } from '../../../../../src/application/use-cases/pools/get-pool-standings/get-pool-standings.query.js';
import { aPool } from '../../../../support/pools.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ListAdminPoolsHandler', () => {
  it('live pools then the newest settled ones, each with its winners list and its hold', async () => {
    const ctx = unitContext();
    await ctx.pools.upsert(aPool({ id: 1, status: 'active', ticketsSold: 4 }, ctx.now()));
    await ctx.pools.upsert(aPool({ id: 2, status: 'settled' }, ctx.now()));
    await ctx.pools.upsert(aPool({ id: 3, status: 'refunding' }, ctx.now()));
    await ctx.pools.saveHold(1, { by: 'Admin', at: ctx.now(), note: 'wait' });
    const standings = new GetPoolStandingsHandler(ctx.pools, ctx.poolPayouts, ctx.rideQuery);
    const queries = { execute: (q: GetPoolStandingsQuery) => standings.execute(q) } as unknown as QueryBus;
    const { pools } = await new ListAdminPoolsHandler(ctx.pools, queries).execute();
    expect(pools.map((p) => [p.pool.id, p.standings.poolId, p.hold?.note ?? null])).toEqual([[1, 1, 'wait'], [2, 2, null]]);
    expect(pools[0]?.pool.payout.held).toBe(true);
  });
});
