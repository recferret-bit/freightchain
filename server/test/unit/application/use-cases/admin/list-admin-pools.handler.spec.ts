import { ListAdminPoolsHandler } from '../../../../../src/application/use-cases/admin/list-admin-pools/list-admin-pools.handler.js';
import { ListAdminPoolsQuery } from '../../../../../src/application/use-cases/admin/list-admin-pools/list-admin-pools.query.js';
import { poolProps } from '../../../../support/pools.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ListAdminPoolsHandler', () => {
  it('the mirrored pools, newest first, times as epoch ms, limit applies', async () => {
    const ctx = unitContext();
    const old = poolProps({ id: 1, createdAt: new Date(ctx.clock.ms - 1000) }, ctx.now());
    ctx.db.pools.set(1, old);
    ctx.db.pools.set(2, poolProps({ id: 2, status: 'active', ticketsSold: 3, buyers: 2, vaultLamports: 150_000_000 }, ctx.now()));
    const h = new ListAdminPoolsHandler(ctx.adminDirectory);
    const { rows } = await h.execute(new ListAdminPoolsQuery(10));
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ id: 2, status: 'active', ticketsSold: 3, buyers: 2, vaultLamports: 150_000_000, prepDeadline: poolProps({ id: 2 }, ctx.now()).prepDeadline.getTime(), syncedAt: null });
    expect((await h.execute(new ListAdminPoolsQuery(1))).rows).toHaveLength(1);
  });
});
