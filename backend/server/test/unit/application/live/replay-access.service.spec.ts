import { ReplayAccessService } from '../../../../src/application/live/replay-access.service.js';
import { NotFoundError } from '../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../support/unit-context.js';
import { aPool } from '../../../support/pools.js';

describe('ReplayAccessService', () => {
  const setup = () => {
    const ctx = unitContext();
    return { ctx, access: new ReplayAccessService(ctx.rides, ctx.players, ctx.pools, ctx.verdictRepo, ctx.clock) };
  };

  it('hides a running ride from everyone, including its driver', async () => {
    const { ctx, access } = setup();
    const ride = await ctx.paidRide('driver', true);
    await expect(access.requireWatchable(ride.id, null)).rejects.toThrow(new NotFoundError('replay is not available', 'replay_not_available'));
    await expect(access.requireWatchable(ride.id, 'driver')).rejects.toThrow(new NotFoundError('replay is not available', 'replay_not_available'));
  });

  it('hides a finished training ride and opens a finished 1h ride', async () => {
    const { ctx, access } = setup();
    const free = await ctx.freeRide('driver', true);
    free.finish('failed', 'done', ctx.now()); await ctx.rides.save(free);
    await expect(access.requireWatchable(free.id, null)).rejects.toMatchObject({ errorCode: 'replay_not_available' });
    const paid = await ctx.paidRide('driver', true);
    paid.finish('failed', 'done', ctx.now()); await ctx.rides.save(paid);
    await expect(access.requireWatchable(paid.id, null)).resolves.toMatchObject({ id: paid.id });
  });

  it('keeps a pool replay for its driver until payout, and 404s everyone else', async () => {
    const { ctx, access } = setup();
    const ride = await ctx.paidRide('driver', true);
    ride.props.poolId = 7;
    ride.finish('failed', 'done', ctx.now()); await ctx.rides.save(ride);
    await ctx.pools.upsert(aPool({ id: 7, payoutAt: new Date(ctx.clock.ms + 60_000) }, ctx.now()));
    await expect(access.requireWatchable(ride.id, 'fan')).rejects.toMatchObject({ errorCode: 'replay_locked_until_payout' });
    await expect(access.requireWatchable(ride.id, 'driver')).resolves.toMatchObject({ id: ride.id });
  });
});
