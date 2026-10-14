import { StartRideHandler } from '../../../../../src/application/use-cases/rides/start-ride/start-ride.handler.js';
import { StartRideCommand } from '../../../../../src/application/use-cases/rides/start-ride/start-ride.command.js';
import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';

const setup = () => {
  const ctx = unitContext();
  const analytics = new RecordingAnalytics();
  const handler = new StartRideHandler(ctx.lookup, ctx.rides, ctx.players, ctx.cosmetics, ctx.rules, ctx.transactions, ctx.clock, analytics, ctx.stats);
  return { ctx, analytics, start: (id: string, wallet = 'w', trip: string | null = null) => handler.execute(new StartRideCommand(wallet, id, trip)) };
};

describe('StartRideHandler', () => {
  it('starts a ready ride: the server clock for it starts now', async () => {
    const { ctx, start } = setup();
    const ride = await ctx.freeRide('w');
    expect(await start(ride.id)).toMatchObject({ status: 'running' });
    expect((await ctx.reload(ride.id)).snapshot().startedAt).toEqual(ctx.now());
  });

  it('starting a ride with the TUTORIAL on marks the player as having done it – once; without the tutorial it does not', async () => {
    const { ctx, start } = setup();
    const plain = await ctx.freeRide('w');
    await start(plain.id);
    expect((await ctx.storedPlayer('w')).tutorialPassedAt).toBeNull();
    const done = await ctx.reload(plain.id); done.finish('failed', null, ctx.now()); await ctx.rides.save(done);
    const ride = Ride.createFree({ id: 'tut-1', wallet: 'w', seed: 5, minSeconds: 10, now: ctx.now(), tutorial: true, assist: true });
    await ctx.rides.insert(ride);
    const first = ctx.now();
    expect(await start('tut-1')).toMatchObject({ status: 'running', tutorial: true, assist: true });
    expect((await ctx.storedPlayer('w')).tutorialPassedAt).toEqual(first);
    const stamp = (await ctx.storedPlayer('w')).tutorialPassedAt;
    const r = await ctx.reload('tut-1'); r.finish('failed', null, ctx.now()); await ctx.rides.save(r);
    ctx.clock.advance(60);
    await ctx.rides.insert(Ride.createFree({ id: 'tut-2', wallet: 'w', seed: 6, minSeconds: 10, now: ctx.now(), tutorial: true }));
    await start('tut-2');
    expect((await ctx.storedPlayer('w')).tutorialPassedAt).toEqual(stamp);   // the first stamp stays
  });

  it('the ride keeps what the wallet wears at the start (all classic when it wears nothing) – and the answer says it, for the game', async () => {
    const { ctx, start } = setup();
    const plain = await ctx.freeRide('w');
    const classic = { wheel: 'classic', truck_color: 'red', gearbox: 'stick', dice: 'white', needle: 'orange', ornament: 'spear', dash: 'stock', indicator: 'amber', phone: 'black' };
    expect(await start(plain.id)).toMatchObject({ loadout: classic });
    expect((await ctx.reload(plain.id)).loadout).toEqual(classic);
    for (const [slot, item] of [['wheel', 'gold'], ['truck_color', 'blue']] as const) { await ctx.cosmetics.unlock({ wallet: 'v', slot, item, code: 'X', at: ctx.now() }); await ctx.cosmetics.equip('v', slot, item); }
    const styled = await ctx.freeRide('v');
    expect(await start(styled.id, 'v')).toMatchObject({ loadout: { wheel: 'gold', truck_color: 'blue', gearbox: 'stick', dice: 'white', needle: 'orange' } });
    expect((await ctx.reload(styled.id)).loadout).toEqual({ ...classic, wheel: 'gold', truck_color: 'blue' });
  });

  it('ride_started tells PostHog what the ride is driven with – one property per slot – and keeps it on the person (all classic for a wallet that wears nothing)', async () => {
    const { ctx, analytics, start } = setup();
    const plain = await ctx.freeRide('w');
    await start(plain.id);
    expect(analytics.named('ride_started')[0]).toMatchObject({ properties: { ride_id: plain.id, wheel: 'classic', truck_color: 'red', gearbox: 'stick', dice: 'white', needle: 'orange', tutorial: false, assist: false }, set: { wheel: 'classic', truck_color: 'red', gearbox: 'stick', dice: 'white', needle: 'orange' } });
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
    const ready = await ctx.paidOrder('w2', 50_000_000, { offer: false }); // w already accepted above; this wallet never did
    ready.markPaid(1, ctx.now()); await ctx.rides.save(ready);
    await expect(start(ready.id, 'w2')).rejects.toMatchObject({ errorCode: 'agreements_required' });
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

  it('statistics: the stale ride a new start clears joins the totals (what it drove, once)', async () => {
    const { ctx, start } = setup();
    const first = await ctx.paidOrder('w');
    first.markPaid(1, ctx.now()); await ctx.rides.save(first);
    const second = await ctx.paidOrder('w');
    second.markPaid(1, ctx.now()); await ctx.rides.save(second);
    await start(first.id);
    ctx.clock.advance(5);
    const running = await ctx.reload(first.id);
    running.applyReport({ s: 60, t: 5, hull: 100, paused: false, night: false }, ctx.now(), ctx.rules.get()); await ctx.rides.save(running);
    ctx.clock.advance(151);
    await start(second.id);
    expect(await ctx.stats.player('w')).toMatchObject({ rides: 1, metres: 60, seconds: 5 });   // the second one is running – not counted yet
  });
  it('the trip the game built its road from must still be the ride\'s: a ride re-chosen in the lobby meanwhile is a 409 ride_rechosen and stays ready; absent = not compared', async () => {
    const { ctx, start, analytics } = setup();
    const ride = await ctx.freeRide('w');                                        // EASY = free-1c
    const r = await ctx.reload(ride.id); r.chooseFree(3, 100, false, false); await ctx.rides.save(r);   // the lobby re-chose HARD after the game read the ride
    await expect(start(ride.id, 'w', 'free-1c')).rejects.toThrow(new ConflictError('the ride was re-chosen: it is driven on free-3b now, not free-1c – load it again', 'ride_rechosen'));
    expect((await ctx.reload(ride.id)).status).toBe(RideStatus.Created);
    expect(analytics.named('ride_started')).toHaveLength(0);
    expect(await start(ride.id, 'w', 'free-3b')).toMatchObject({ status: 'running', trip: 'free-3b' });
    const old = Ride.restore({ ...(await ctx.freeRide('v')).snapshot(), trip: null });   // a ride from before trips: the 'classic' road
    await ctx.rides.save(old);
    await expect(start(old.id, 'v', 'free-1c')).rejects.toMatchObject({ errorCode: 'ride_rechosen', statusCode: 409 });
    expect(await start(old.id, 'v', 'classic')).toMatchObject({ status: 'running' });
    const plain = await ctx.freeRide('x');
    expect(await start(plain.id, 'x')).toMatchObject({ status: 'running' });   // an older game says nothing: started as before
  });
});
