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
    const handler = new WatchRideHandler(ctx.rides, ctx.batches, ctx.rideEvents, ctx.viewers, ctx.rideMutes, ctx.rules, ctx.clock);
    return { ctx, watch: (id: string, from = 0, after = 0, viewer = '', since = 0, source = '10.0.0.1', leave = false) => handler.execute(new WatchRideQuery(id, from, after, viewer, since, source, leave)) };
  };

  it('a running ride: its seed + route for the road, the recording page from `from` (samples only, no inputs), the feed and the viewers', async () => {
    const { ctx, watch } = setup();
    const ride = await ctx.freeRide('driver', true);
    const bodies = recording(ride.id, { seconds: 60 });
    ctx.clock.advance(60);
    for (const b of bodies) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    ride.applyReport({ s: 140, t: 60, hull: 90, paused: false, night: false }, ctx.now(), ctx.rules.get()); await ctx.rides.save(ride);
    await ctx.rideEvents.insert(RideEvent.message({ rideId: ride.id, wallet: 'fan', text: 'hi', now: ctx.now() }));
    const view = await watch(ride.id, 1, 0, 'viewer-1');
    expect(view.ride).toMatchObject({ id: ride.id, wallet: 'driver', seed: ride.seed, route: 'stuart', loadout: null, status: 'running', live: true, distance: 140, hull: 90, endedAt: null });
    expect(view.recording).toEqual({ lastSeq: 3, t1: bodies[3]!.t1 });
    expect(view.batches.map((b) => b.seq)).toEqual([1, 2, 3]);
    expect(Object.keys(view.batches[0]!).sort()).toEqual(['samples', 'seq', 't0', 't1']);
    expect(view.batches[0]!.samples).toEqual(bodies[1]!.samples);
    expect(view.events.map((e) => e.text)).toEqual(['hi']);
    expect(view.viewers).toBe(1);
    expect((await watch(ride.id, 0, 0, 'viewer-2')).viewers).toBe(2);
    expect((await watch(ride.id, 0, 0, '')).viewers).toBe(2); // no viewer id: not counted
  });

  it('the replay columns go out as uploaded – the input column (controls per 100 ms sample) is how spectators see the driver\'s keys and clicks; the raw events never', async () => {
    const { ctx, watch } = setup();
    const ride = await ctx.freeRide('driver', true);
    const [b0] = recording(ride.id, { seconds: 15, replay: true });
    ctx.clock.advance(15);
    await ctx.batches.insert(RideBatch.accept(ride.id, b0!, hashBatch(b0!), ctx.now()));
    const [served] = (await watch(ride.id)).batches;
    expect(served!.samples).toEqual(b0!.samples);
    expect(served!.samples.map((r) => r[SAMPLE_INPUT_COL])).toContain(INPUT_BIT.gas);
    expect(JSON.stringify(served)).not.toContain('KeyW');
  });

  it('what the driver wore goes with it, so spectators and replays draw the real cockpit', async () => {
    const { ctx, watch } = setup();
    const ride = await ctx.freeRide('driver');
    ride.start(ctx.now(), { wheel: 'gold', truck_color: 'blue', gearbox: 'stick', dice: 'white', needle: 'orange' }); await ctx.rides.save(ride);
    expect((await watch(ride.id)).ride.loadout).toEqual({ wheel: 'gold', truck_color: 'blue', gearbox: 'stick', dice: 'white', needle: 'orange' });
  });

  it('pages the recording (a long replay is fetched as it plays); an ended ride is a replay with no viewers', async () => {
    const { ctx, watch } = setup();
    const ride = await ctx.freeRide('driver', true);
    ctx.clock.advance(3600);
    for (const b of recording(ride.id, { seconds: 600 })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    ride.finish('shift', null, ctx.now()); await ctx.rides.save(ride);
    const view = await watch(ride.id, 0, 0, 'v');
    expect(view.batches).toHaveLength(WATCH_BATCH_PAGE);
    expect(view.recording.lastSeq).toBe(39);
    expect(view).toMatchObject({ viewers: 0, ride: { live: false, status: 'abandoned', endedAt: ctx.clock.ms } });
    expect((await watch(ride.id, 30)).batches.map((b) => b.seq)).toEqual([30, 31, 32, 33, 34, 35, 36, 37, 38, 39]);
  });

  it('an effect stamped after the spectator\'s cursor moved past it comes back through `since` (once, in id order)', async () => {
    const { ctx, watch } = setup();
    const ride = await ctx.freeRide('driver', true);
    const hole = (await ctx.rideEvents.insert(RideEvent.donation({ rideId: ride.id, wallet: 'fan', effect: 'sinkhole', now: ctx.now() })))!;
    ctx.clock.advance(5);
    const first = await watch(ride.id, 0, 0);
    expect(first.events[0]?.applied).toBeNull();
    ctx.clock.advance(5);
    hole.markApplied({ t: 9, s: 1400, lat: 2.4 }, ctx.now()); await ctx.rideEvents.saveApplied(hole);
    const later = await watch(ride.id, 0, hole.id!, '', first.now - 5000); // the cursor is past the event already
    expect(later.events.map((e) => [e.id, e.applied?.s])).toEqual([[hole.id, 1400]]);
    expect((await watch(ride.id, 0, 0, '', first.now - 5000)).events).toHaveLength(1); // new + stamped: no duplicate
    expect((await watch(ride.id, 0, hole.id!, '', ctx.clock.ms)).events).toEqual([]);
  });

  it('a script inventing viewer ids from one address counts as at most 3 viewers', async () => {
    const { ctx, watch } = setup();
    const ride = await ctx.freeRide('driver', true);
    for (let i = 0; i < 10; i++) await watch(ride.id, 0, 0, `fake-${i}`, 0, '10.9.9.9');
    expect((await watch(ride.id, 0, 0, 'real', 0, '10.0.0.2')).viewers).toBe(4);
  });

  it('a closing watch page (leave) stops counting at once – only its own id from its own address', async () => {
    const { ctx, watch } = setup();
    const ride = await ctx.freeRide('driver', true);
    await watch(ride.id, 0, 0, 'viewer-a', 0, '10.0.0.1'); await watch(ride.id, 0, 0, 'viewer-b', 0, '10.0.0.2');
    expect((await watch(ride.id, 0, 0, 'viewer-a', 0, '10.0.0.9', true)).viewers).toBe(2);   // another address cannot make viewer-a leave
    expect((await watch(ride.id, 0, 0, 'viewer-a', 0, '10.0.0.1', true)).viewers).toBe(1);
    expect((await watch(ride.id)).viewers).toBe(1);   // and the leave registered nobody
  });

  it('carries the ride\'s features and hides what the driver muted (lines gone, notes blanked, donations kept)', async () => {
    const { ctx, watch } = setup();
    const ride = await ctx.freeRide('driver', true);
    await ctx.rideEvents.insert(RideEvent.message({ rideId: ride.id, wallet: 'troll', text: 'boo', now: ctx.now() }));
    await ctx.rideEvents.insert(RideEvent.donation({ rideId: ride.id, wallet: 'troll', effect: 'tip', note: 'rude', now: ctx.now() }));
    await ctx.rideMutes.set(ride.id, 'troll', true, ctx.now());
    const view = await watch(ride.id);
    expect(view.events.map((e) => [e.kind, e.text])).toEqual([['donation', null]]);
    expect(view.features).toEqual({ chat: true, donations: true, payment: 'mock', effects: true });
  });

  it('nothing to watch before the start (no seed handed out early), and an unknown id is 404', async () => {
    const { ctx, watch } = setup();
    const unstarted = await ctx.freeRide('driver');
    await expect(watch(unstarted.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(watch('missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});
