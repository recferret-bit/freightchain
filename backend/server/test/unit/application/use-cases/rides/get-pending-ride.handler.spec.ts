import { GetPendingRideHandler } from '../../../../../src/application/use-cases/rides/get-pending-ride/get-pending-ride.handler.js';
import { GetPendingRideQuery } from '../../../../../src/application/use-cases/rides/get-pending-ride/get-pending-ride.query.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetPendingRideHandler', () => {
  it('null without paid orders; free rides never count', async () => {
    const ctx = unitContext();
    await ctx.freeRide('w');
    expect(await new GetPendingRideHandler(ctx.rides, ctx.clock).execute(new GetPendingRideQuery('w'))).toEqual({ ride: null });
  });

  it('a paid-and-unstarted ride first; an unpaid or lapsed order (≤ 24 h) otherwise', async () => {
    const ctx = unitContext();
    const handler = new GetPendingRideHandler(ctx.rides, ctx.clock);
    const lapsed = await ctx.paidOrder('w');
    lapsed.expire(ctx.now()); await ctx.rides.save(lapsed);
    expect((await handler.execute(new GetPendingRideQuery('w'))).ride).toMatchObject({ id: lapsed.id, status: 'expired' });
    const paid = await ctx.paidOrder('w');
    paid.markPaid(1, ctx.now()); await ctx.rides.save(paid);
    expect((await handler.execute(new GetPendingRideQuery('w'))).ride).toMatchObject({ id: paid.id, status: 'created' });
  });

  it('a lapsed order older than 24 h is no longer owed', async () => {
    const ctx = unitContext();
    const lapsed = await ctx.paidOrder('w');
    lapsed.expire(ctx.now()); await ctx.rides.save(lapsed);
    ctx.clock.advance(86_401);
    expect((await new GetPendingRideHandler(ctx.rides, ctx.clock).execute(new GetPendingRideQuery('w'))).ride).toBeNull();
  });
});
