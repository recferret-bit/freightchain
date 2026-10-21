import { WatchRideHandler } from '../../../../../src/application/use-cases/live/watch-ride/watch-ride.handler.js';
import { WatchRideQuery } from '../../../../../src/application/use-cases/live/watch-ride/watch-ride.query.js';
import { RideEvent } from '../../../../../src/domain/live/ride-event.entity.js';
import { RideBatch } from '../../../../../src/domain/telemetry/ride-batch.entity.js';
import { WATCH_BATCH_PAGE } from '../../../../../src/domain/live/live-rules.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { hashBatch, INPUT_BIT, recording } from '../../../../support/recording.js';
import { SAMPLE_INPUT_COL } from '../../../../../src/domain/telemetry/telemetry-rules.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('WatchRideHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const handler = new WatchRideHandler(ctx.replayAccess, ctx.batches, ctx.rideEvents, ctx.viewers, ctx.rideMutes, ctx.rules, ctx.clock);
    const finish = async (ride: Awaited<ReturnType<typeof ctx.paidRide>>) => {
      ride.finish('failed', 'done', ctx.now());
      return ctx.rides.save(ride);
    };
    const watch = (id: string, from = 0, after = 0, viewer = '', since = 0, source = '10.0.0.1', leave = false) => handler.execute(new WatchRideQuery(id, from, after, viewer, since, source, leave));
    return { ctx, finish, watch };
  };

  it('a running ride is not watchable', async () => {
    const { ctx, watch } = setup();
    const ride = await ctx.paidRide('driver', true);
    await expect(watch(ride.id)).rejects.toThrow(new NotFoundError('replay is not available', 'replay_not_available'));
  });

  it('a finished 1h replay serves the recording with the input column zeroed, and counts viewers', async () => {
    const { ctx, finish, watch } = setup();
    const ride = await ctx.paidRide('driver', true);
    const bodies = recording(ride.id, { seconds: 30, replay: true });
    ctx.clock.advance(30);
    for (const b of bodies) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    ride.applyReport({ s: 140, t: 30, hull: 90, paused: false, night: false }, ctx.now(), ctx.rules.get());
    ride.finish('failed', 'done', ctx.now());
    await ctx.rides.save(ride);
    await ctx.rideEvents.insert(RideEvent.message({ rideId: ride.id, wallet: 'fan', text: 'hi', now: ctx.now() }));
    const view = await watch(ride.id, 0, 0, 'viewer-1');
    expect(view.ride).toMatchObject({ id: ride.id, status: 'failed', live: false, distance: 140, hull: 90 });
    const samples = view.batches.flatMap((b) => b.samples);
    expect(samples.map((row) => row[SAMPLE_INPUT_COL])).toEqual(samples.map(() => 0));
    expect(samples.some((row) => (row[SAMPLE_INPUT_COL] ?? 0) & INPUT_BIT.gas)).toBe(false);
    expect(JSON.stringify(view)).not.toContain('KeyW');
    expect(view.events.map((e) => e.text)).toEqual(['hi']);
    expect(view.viewers).toBe(1);
    expect(view.features.effects).toBe(false);
  });

  it('pages a long replay and hides a muted note', async () => {
    const { ctx, finish, watch } = setup();
    const ride = await finish(await ctx.paidRide('driver', true));
    ctx.clock.advance(3600);
    for (const b of recording(ride.id, { seconds: 600 })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    await ctx.rideEvents.insert(RideEvent.donation({ rideId: ride.id, wallet: 'troll', effect: 'tip', note: 'rude', now: ctx.now() }));
    await ctx.rideMutes.set(ride.id, 'troll', true, ctx.now());
    const view = await watch(ride.id);
    expect(view.batches).toHaveLength(WATCH_BATCH_PAGE);
    expect(view.events.map((e) => e.text)).toEqual([null]);
    for (let i = 0; i < 10; i++) await watch(ride.id, 0, 0, `fake-${i}`, 0, '10.9.9.9');
    expect((await watch(ride.id, 0, 0, 'real', 0, '10.0.0.2')).viewers).toBe(4);
  });

  it('a training ride stays hidden after it ends; an unstarted ride hands out no seed', async () => {
    const { ctx, watch } = setup();
    const free = await ctx.freeRide('driver', true);
    await expect(watch(free.id)).rejects.toMatchObject({ errorCode: 'replay_not_available' });
    free.finish('shift', null, ctx.now()); await ctx.rides.save(free);
    await expect(watch(free.id)).rejects.toMatchObject({ errorCode: 'replay_not_available' });
    const unstarted = await ctx.paidRide('driver', false);
    await expect(watch(unstarted.id)).rejects.toMatchObject({ errorCode: 'not_found' });
  });
});
