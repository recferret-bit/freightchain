import { HoldPoolPayoutCommand } from '../../../../../src/application/use-cases/admin/hold-pool-payout/hold-pool-payout.command.js';
import { HoldPoolPayoutHandler } from '../../../../../src/application/use-cases/admin/hold-pool-payout/hold-pool-payout.handler.js';
import { NotFoundError, UnauthorizedError } from '../../../../../src/domain/shared/errors.js';
import { testAdmin } from '../../../../support/admin-fixtures.js';
import { aPool } from '../../../../support/pools.js';
import { unitContext, type UnitContext } from '../../../../support/unit-context.js';

const handlerOf = (ctx: UnitContext) => new HoldPoolPayoutHandler(ctx.pools, ctx.proofs, ctx.adminActions, ctx.transactions, ctx.clock);

describe('HoldPoolPayoutHandler', () => {
  it('holds a live pool (who, when, note) and releases it – each signed for exactly that pool and decision, and audited', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    await ctx.pools.upsert(aPool({ id: 3, status: 'active', ticketsSold: 5 }, ctx.now()));
    const sig = await admin.sign({ action: 'pool_hold', poolId: 3, hold: true, note: 'rank 2 looks odd' });
    expect(await handlerOf(ctx).execute(new HoldPoolPayoutCommand(admin.wallet, 3, true, 'rank 2 looks odd', 'req-1', sig)))
      .toEqual({ poolId: 3, held: true, by: admin.wallet, at: ctx.now().getTime(), note: 'rank 2 looks odd' });
    expect((await ctx.pools.findById(3))?.hold).toEqual({ by: admin.wallet, at: ctx.now(), note: 'rank 2 looks odd' });
    expect(ctx.db.adminActions[0]).toMatchObject({ wallet: admin.wallet, action: 'pool.hold', target: '3', detail: { note: 'rank 2 looks odd', signed: { signature: sig } }, requestId: 'req-1' });
    const off = await admin.sign({ action: 'pool_hold', poolId: 3, hold: false, note: null });
    expect(await handlerOf(ctx).execute(new HoldPoolPayoutCommand(admin.wallet, 3, false, null, null, off))).toMatchObject({ held: false, by: null });
    expect((await ctx.pools.findById(3))?.hold).toBeNull();
    expect(ctx.db.adminActions[1]).toMatchObject({ action: 'pool.release', target: '3' });
  });

  it('refuses: a signature for another pool or decision (401), an unknown pool (404), a pool already paid or not live (409)', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    await ctx.pools.upsert(aPool({ id: 3, status: 'active', ticketsSold: 5 }, ctx.now()));
    const other = await admin.sign({ action: 'pool_hold', poolId: 4, hold: true, note: null });
    await expect(handlerOf(ctx).execute(new HoldPoolPayoutCommand(admin.wallet, 3, true, null, null, other))).rejects.toBeInstanceOf(UnauthorizedError);
    const ghost = await admin.sign({ action: 'pool_hold', poolId: 9, hold: true, note: null });
    await expect(handlerOf(ctx).execute(new HoldPoolPayoutCommand(admin.wallet, 9, true, null, null, ghost))).rejects.toBeInstanceOf(NotFoundError);
    await ctx.pools.upsert(aPool({ id: 5, status: 'settled' }, ctx.now()));
    const settled = await admin.sign({ action: 'pool_hold', poolId: 5, hold: true, note: null });
    await expect(handlerOf(ctx).execute(new HoldPoolPayoutCommand(admin.wallet, 5, true, null, null, settled))).rejects.toMatchObject({ errorCode: 'not_holdable' });
    await ctx.pools.upsert(aPool({ id: 6, status: 'active', ticketsSold: 5 }, ctx.now()));
    await ctx.pools.savePayout(6, 'paid', null);
    const paid = await admin.sign({ action: 'pool_hold', poolId: 6, hold: true, note: null });
    await expect(handlerOf(ctx).execute(new HoldPoolPayoutCommand(admin.wallet, 6, true, null, null, paid))).rejects.toMatchObject({ errorCode: 'not_holdable' });
    expect(ctx.db.adminActions).toEqual([]);
  });
});
