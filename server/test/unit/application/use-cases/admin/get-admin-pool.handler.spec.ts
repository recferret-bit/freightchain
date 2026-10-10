import { GetAdminPoolHandler } from '../../../../../src/application/use-cases/admin/get-admin-pool/get-admin-pool.handler.js';
import { GetAdminPoolQuery } from '../../../../../src/application/use-cases/admin/get-admin-pool/get-admin-pool.query.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { poolProps } from '../../../../support/pools.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetAdminPoolHandler', () => {
  it('a pool with its split, treasuries and ticket holders (most bought first); an unknown id is a 404', async () => {
    const ctx = unitContext();
    ctx.db.pools.set(7, poolProps({ id: 7 }, ctx.now()));
    ctx.db.tickets.set('a|7', { wallet: 'a', poolId: 7, balance: 1, bought: 1, version: 1 });
    ctx.db.tickets.set('b|7', { wallet: 'b', poolId: 7, balance: 0, bought: 3, version: 1 });
    ctx.db.tickets.set('c|8', { wallet: 'c', poolId: 8, balance: 9, bought: 9, version: 1 });
    const h = new GetAdminPoolHandler(ctx.adminDirectory);
    const d = await h.execute(new GetAdminPoolQuery(7));
    expect(d.pool).toMatchObject({ id: 7, prizeBps: 7000, seedBps: 2000, feeBps: 1000, rideSeed: 4242 });
    expect(d.holders).toEqual([{ wallet: 'b', balance: 0, bought: 3 }, { wallet: 'a', balance: 1, bought: 1 }]);
    await expect(h.execute(new GetAdminPoolQuery(99))).rejects.toBeInstanceOf(NotFoundError);
  });
});
