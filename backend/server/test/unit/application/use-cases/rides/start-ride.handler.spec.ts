import { StartRideHandler } from '../../../../../src/application/use-cases/rides/start-ride/start-ride.handler.js';
import { StartRideCommand } from '../../../../../src/application/use-cases/rides/start-ride/start-ride.command.js';
import { RankedEntryService } from '../../../../../src/application/services/ranked-entry.service.js';
import { PrizeGeoPort } from '../../../../../src/application/ports/prize/prize-geo.port.js';
import { HeaderGeoAdapter } from '../../../../../src/infrastructure/prize/header-geo.adapter.js';
import { DEFAULT_GEO } from '../../../../../src/domain/prize/prize-rules.js';
import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';
import { aPool } from '../../../../support/pools.js';
import { PoolScheduleService } from '../../../../../src/application/services/pool-schedule.service.js';
import { TelemetryConfigPort } from '../../../../../src/application/ports/telemetry/telemetry-config.port.js';
import { toRideDto } from '../../../../../src/domain/rides/ride.dto.js';
import { revealRideSalts } from '../../../../../src/application/rides/ride-salts.js';
import { RoadPlan } from '../../../../../src/domain/road/road-plan.js';
import { HOLE_SALT_LABEL, TRAFFIC_SALT_LABEL, saltMessage } from '../../../../../src/domain/shared/index.js';
import { createHash, createHmac } from 'node:crypto';

class ShadowTelemetry extends TelemetryConfigPort {
  mode() { return 'shadow' as const; }
}

class DefaultLists extends PrizeGeoPort { rules() { return DEFAULT_GEO; } }

const setup = () => {
  const ctx = unitContext();
  const analytics = new RecordingAnalytics();
  const rankedEntry = new RankedEntryService(ctx.rides, new HeaderGeoAdapter(), new DefaultLists());
  const handler = new StartRideHandler(ctx.lookup, ctx.rides, ctx.players, ctx.cosmetics, ctx.rules, ctx.transactions, ctx.clock, analytics, ctx.stats, ctx.pools, rankedEntry, new PoolScheduleService(ctx.poolChain, ctx.clock, ctx.entropy));
  return {
    ctx, analytics,
    start: (id: string, wallet = 'w', trip: string | null = null) => handler.execute(new StartRideCommand(wallet, id, trip)),
    startRanked: (id: string, wallet: string, headers: Record<string, string>) => handler.execute(new StartRideCommand(wallet, id, null, true, headers)),
  };
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

  it('a ticket ride ordered in time starts while it can still reach its finish line by the pool\'s play deadline – else 409 rides_closed, the ride is closed and the ticket stays in the pot (H6)', async () => {
    const { ctx, start } = setup();
    const ticketRide = async (playIn: number) => {
      const t = ctx.now().getTime(), id = ctx.entropy.uuid();
      await ctx.pools.upsert(aPool({ id: playIn, status: 'active', prepDeadline: new Date(t - 60_000), playDeadline: new Date(t + playIn * 1000), payoutAt: new Date(t + playIn * 1000) }, ctx.now()));
      await ctx.paidOrder('w');
      const ride = Ride.createFromTicket({ id, wallet: 'w', tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, poolId: playIn, roundId: 1, now: ctx.now() });
      await ctx.rides.insert(ride);
      return id;
    };
    const late = await ticketRide(4499);   // last start is play close − 75 min: one second past it
    await expect(start(late)).rejects.toMatchObject({ errorCode: 'pool_last_start_passed' });
    expect(await ctx.reload(late)).toMatchObject({ status: RideStatus.Cancelled });
    await expect(start(late)).rejects.toThrow(/ride is cancelled/);
    const inTime = await ticketRide(4500);   // exactly at last start: still allowed (now > lastStart is the cutoff)
    expect((await start(inTime)).status).toBe('running');
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
    await expect(start(ride.id, 'w', 'free-1c')).rejects.toThrow(new ConflictError('the ride was re-chosen: it is driven on free-3c now, not free-1c – load it again', 'ride_rechosen'));
    expect((await ctx.reload(ride.id)).status).toBe(RideStatus.Created);
    expect(analytics.named('ride_started')).toHaveLength(0);
    expect(await start(ride.id, 'w', 'free-3c')).toMatchObject({ status: 'running', trip: 'free-3c' });
    const old = Ride.restore({ ...(await ctx.freeRide('v')).snapshot(), trip: null });   // a ride from before trips: the 'classic' road
    await ctx.rides.save(old);
    await expect(start(old.id, 'v', 'free-1c')).rejects.toMatchObject({ errorCode: 'ride_rechosen', statusCode: 409 });
    expect(await start(old.id, 'v', 'classic')).toMatchObject({ status: 'running' });
    const plain = await ctx.freeRide('x');
    expect(await start(plain.id, 'x')).toMatchObject({ status: 'running' });   // an older game says nothing: started as before
  });

  it('a ranked start stores the flag and the country; a refusal leaves the ride created so it can start unranked', async () => {
    const { ctx, start, startRanked } = setup();
    const training = await ctx.freeRide('w');
    await expect(startRanked(training.id, 'w', { 'cf-ipcountry': 'CA' })).rejects.toMatchObject({ errorCode: 'ranked_training' });
    expect((await ctx.reload(training.id)).status).toBe(RideStatus.Created);
    const ride = await ctx.paidRide('w', false);
    await expect(startRanked(ride.id, 'w', {})).rejects.toMatchObject({ errorCode: 'ranked_ineligible' });
    expect((await ctx.reload(ride.id)).status).toBe(RideStatus.Created);
    expect(await startRanked(ride.id, 'w', { 'cf-ipcountry': 'CA' })).toMatchObject({ status: 'running', ranked: true });
    expect((await ctx.reload(ride.id)).snapshot()).toMatchObject({ ranked: true, prizeCountry: 'CA', prizeRegion: null });
    const blocked = await ctx.paidRide('w', false);
    const running = await ctx.reload(ride.id); running.finish('failed', null, ctx.now()); await ctx.rides.save(running);
    await expect(startRanked(blocked.id, 'w', { 'cf-ipcountry': 'US', 'cf-region-code': 'DE' })).rejects.toMatchObject({ errorCode: 'ranked_ineligible' });
    expect(await start(blocked.id)).toMatchObject({ status: 'running', ranked: false });
  });

  it('a start with telemetry off has no session key', async () => {
    const { ctx, start } = setup();
    const ride = await ctx.freeRide('w');
    const dto = await start(ride.id);
    expect(dto).not.toHaveProperty('sessionKey');
    expect(dto).not.toHaveProperty('trafficSaltCommit');
    expect((await ctx.reload(ride.id)).sessionKey).toBeNull();
    expect((await ctx.reload(ride.id)).trafficSaltCommit).toBeNull();
  });

  it('shadow telemetry returns the session key on start only', async () => {
    const { ctx, analytics } = setup();
    const rankedEntry = new RankedEntryService(ctx.rides, new HeaderGeoAdapter(), new DefaultLists());
    const handler = new StartRideHandler(ctx.lookup, ctx.rides, ctx.players, ctx.cosmetics, ctx.rules, ctx.transactions, ctx.clock, analytics, ctx.stats, ctx.pools, rankedEntry, new PoolScheduleService(ctx.poolChain, ctx.clock, ctx.entropy), undefined, new ShadowTelemetry(), ctx.entropy);
    const ride = await ctx.freeRide('w');
    const dto = await handler.execute(new StartRideCommand('w', ride.id, null));
    expect(dto.sessionKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(dto).toMatchObject({ keyId: 'v2', protocol: 2, status: 'running' });
    const saved = await ctx.reload(ride.id);
    expect(saved.sessionKey).toBe(dto.sessionKey);
    expect(toRideDto(saved).sessionKey).toBeUndefined();
    expect(analytics.named('ride_started')[0]?.properties).not.toHaveProperty('sessionKey');
    expect(dto).not.toHaveProperty('trafficSaltCommit');
  });

  it('shadow telemetry commits salts that reveal from the ride id and leaves the road plan alone', async () => {
    const { ctx, analytics } = setup();
    const rankedEntry = new RankedEntryService(ctx.rides, new HeaderGeoAdapter(), new DefaultLists());
    const handler = new StartRideHandler(ctx.lookup, ctx.rides, ctx.players, ctx.cosmetics, ctx.rules, ctx.transactions, ctx.clock, analytics, ctx.stats, ctx.pools, rankedEntry, new PoolScheduleService(ctx.poolChain, ctx.clock, ctx.entropy), undefined, new ShadowTelemetry(), ctx.entropy, ctx.hasher);
    const ride = await ctx.freeRide('w');
    const holes = () => RoadPlan.forSeed(ride.seed, ride.trip).holesBetween(0, 3000).map((h) => `${h.id}:${h.s}`);
    const before = holes();
    const dto = await handler.execute(new StartRideCommand('w', ride.id, null));
    expect(holes()).toEqual(before);
    expect(dto.trafficSaltCommit).toMatch(/^[0-9a-f]{64}$/);
    expect(dto.holeSaltCommit).toMatch(/^[0-9a-f]{64}$/);
    const revealed = revealRideSalts(ctx.hasher, ride.id, dto.sessionKey!);
    expect(revealed.trafficSaltCommit).toBe(dto.trafficSaltCommit);
    expect(revealed.holeSaltCommit).toBe(dto.holeSaltCommit);
    const key = Buffer.from(dto.sessionKey!, 'base64');
    const traffic = createHmac('sha256', key).update(saltMessage(TRAFFIC_SALT_LABEL, ride.id), 'utf8').digest('hex');
    const hole = createHmac('sha256', key).update(saltMessage(HOLE_SALT_LABEL, ride.id), 'utf8').digest('hex');
    expect(createHash('sha256').update(traffic, 'utf8').digest('hex')).toBe(dto.trafficSaltCommit);
    expect(createHash('sha256').update(hole, 'utf8').digest('hex')).toBe(dto.holeSaltCommit);
    expect(toRideDto(await ctx.reload(ride.id)).trafficSaltCommit).toBeUndefined();
  });
});
