import { StartRideHandler } from '../../../../../src/application/use-cases/rides/start-ride/start-ride.handler.js';
import { StartRideCommand } from '../../../../../src/application/use-cases/rides/start-ride/start-ride.command.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

const setup = () => {
  const ctx = unitContext();
  const handler = new StartRideHandler(ctx.lookup, ctx.rides, ctx.players, ctx.rules, ctx.transactions, ctx.clock);
  return { ctx, start: (id: string, wallet = 'w') => handler.execute(new StartRideCommand(wallet, id)) };
};

describe('StartRideHandler', () => {
  it('starts a ready ride: the server clock for it starts now', async () => {
    const { ctx, start } = setup();
    const ride = await ctx.freeRide('w');
    expect(await start(ride.id)).toMatchObject({ status: 'running' });
    expect((await ctx.reload(ride.id)).snapshot().startedAt).toEqual(ctx.now());
  });

  it('only a "created" ride starts: twice, unpaid or someone else\'s is refused', async () => {
    const { ctx, start } = setup();
    const ride = await ctx.freeRide('w');
    await start(ride.id);
    await expect(start(ride.id)).rejects.toThrow(new ConflictError('ride is running'));
    await expect(start((await ctx.paidOrder('w')).id)).rejects.toThrow(new ConflictError('ride is awaiting_payment'));
    await expect(start(ride.id, 'stranger')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('one RUNNING ride per wallet: a second paid ride waits until the first ends (or its tab vanished)', async () => {
    const { ctx, start } = setup();
    const first = await ctx.paidOrder('w');
    first.markPaid(1, ctx.now()); await ctx.rides.save(first);
    const second = await ctx.paidOrder('w');
    second.markPaid(1, ctx.now()); await ctx.rides.save(second);
    await start(first.id);
    await expect(start(second.id)).rejects.toThrow(new ConflictError('another ride is in progress'));
    ctx.clock.advance(151); // the first ride's tab is gone
    expect(await start(second.id)).toMatchObject({ status: 'running' });
    expect(await ctx.reload(first.id)).toMatchObject({ status: RideStatus.Failed, reason: 'heartbeat lost' });
  });
});
