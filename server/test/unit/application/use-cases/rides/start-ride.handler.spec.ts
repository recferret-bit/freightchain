import { StartRideHandler } from '../../../../../src/application/use-cases/rides/start-ride/start-ride.handler.js';
import { StartRideCommand } from '../../../../../src/application/use-cases/rides/start-ride/start-ride.command.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';

const setup = () => {
  const ctx = unitContext();
  const analytics = new RecordingAnalytics();
  const handler = new StartRideHandler(ctx.lookup, ctx.rides, ctx.players, ctx.cosmetics, ctx.rules, ctx.transactions, ctx.clock, analytics);
  return { ctx, analytics, start: (id: string, wallet = 'w') => handler.execute(new StartRideCommand(wallet, id)) };
};

describe('StartRideHandler', () => {
  it('starts a ready ride: the server clock for it starts now', async () => {
    const { ctx, start } = setup();
    const ride = await ctx.freeRide('w');
    expect(await start(ride.id)).toMatchObject({ status: 'running' });
    expect((await ctx.reload(ride.id)).snapshot().startedAt).toEqual(ctx.now());
  });

  it('the ride keeps what the wallet wears at the start (all classic when it wears nothing) – and the answer says it, for the game', async () => {
    const { ctx, start } = setup();
    const plain = await ctx.freeRide('w');
    const classic = { wheel: 'classic', truck_color: 'red', gearbox: 'stick' };
    expect(await start(plain.id)).toMatchObject({ loadout: classic });
    expect((await ctx.reload(plain.id)).loadout).toEqual(classic);
    for (const [slot, item] of [['wheel', 'gold'], ['truck_color', 'blue']] as const) { await ctx.cosmetics.unlock({ wallet: 'v', slot, item, code: 'X', at: ctx.now() }); await ctx.cosmetics.equip('v', slot, item); }
    const styled = await ctx.freeRide('v');
    expect(await start(styled.id, 'v')).toMatchObject({ loadout: { wheel: 'gold', truck_color: 'blue', gearbox: 'stick' } });
    expect((await ctx.reload(styled.id)).loadout).toEqual({ wheel: 'gold', truck_color: 'blue', gearbox: 'stick' });
  });

  it('ride_started tells PostHog what the ride is driven with – one property per slot – and keeps it on the person (all classic for a wallet that wears nothing)', async () => {
    const { ctx, analytics, start } = setup();
    const plain = await ctx.freeRide('w');
    await start(plain.id);
    expect(analytics.named('ride_started')[0]).toMatchObject({ properties: { ride_id: plain.id, wheel: 'classic', truck_color: 'red', gearbox: 'stick' }, set: { wheel: 'classic', truck_color: 'red', gearbox: 'stick' } });
    await ctx.cosmetics.unlock({ wallet: 'v', slot: 'gearbox', item: 'chrome', code: 'X', at: ctx.now() });
    await ctx.cosmetics.equip('v', 'gearbox', 'chrome');
    const styled = await ctx.freeRide('v');
    await start(styled.id, 'v');
    expect(analytics.named('ride_started')[1]).toMatchObject({ properties: { gearbox: 'chrome', wheel: 'classic' }, set: { gearbox: 'chrome' } });
  });

  it('an item that is worn but not owned (a stale row) is never stamped; changing the wardrobe later does not change a started ride', async () => {
    const { ctx, start } = setup();
    await ctx.cosmetics.equip('w', 'wheel', 'ivory');   // no unlock row
    const ride = await ctx.freeRide('w');
    expect((await start(ride.id)).loadout?.wheel).toBe('classic');
    await ctx.cosmetics.unlock({ wallet: 'w', slot: 'wheel', item: 'moss', code: 'X', at: ctx.now() });
    await ctx.cosmetics.equip('w', 'wheel', 'moss');
    expect((await ctx.reload(ride.id)).loadout?.wheel).toBe('classic');
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
    const { ctx, analytics, start } = setup();
    const first = await ctx.paidOrder('w');
    first.markPaid(1, ctx.now()); await ctx.rides.save(first);
    const second = await ctx.paidOrder('w');
    second.markPaid(1, ctx.now()); await ctx.rides.save(second);
    await start(first.id);
    await expect(start(second.id)).rejects.toThrow(new ConflictError('another ride is in progress'));
    ctx.clock.advance(151); // the first ride's tab is gone
    expect(await start(second.id)).toMatchObject({ status: 'running' });
    expect(await ctx.reload(first.id)).toMatchObject({ status: RideStatus.Failed, reason: 'heartbeat lost' });
    expect(analytics.named('ride_failed').map((e) => e.properties)).toMatchObject([{ ride_id: first.id, fail_code: 'heartbeat_lost', ended_by: 'stale_on_start' }]);
    expect(analytics.named('ride_started').map((e) => e.properties['ride_id'])).toEqual([first.id, second.id]);
  });
});
