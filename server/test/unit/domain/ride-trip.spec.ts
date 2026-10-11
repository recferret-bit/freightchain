import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { RIDE_TIER_IDS } from '../../../src/domain/rides/ride-tier.js';
import { FREE_LEVELS, FREE_LEVEL_IDS, TRIP_IDS, TRIP_OF_TIER, assertAssistAllowed, assertTutorialAllowed, completedLevels, freeLevelSeconds, isFreeLevel, levelOfTrip, tripOf } from '../../../src/domain/rides/ride-trip.js';
import { FREE_COMPLETE_DIST_K, completeDistK } from '../../../src/domain/rides/ride-rules.js';
import { ConflictError } from '../../../src/domain/shared/errors.js';
import { validateEnv } from '../../../src/infrastructure/config/env.schema.js';

/* The server stamps a trip id on every new ride (ride-trip.ts); the game builds that road from client/js/trips.js – the two lists must be the same,
   and the free run's offline shift in trips.js (the old 'free' trip and each free LEVEL) must be the one the server hands out. */
const clientTrips = async (): Promise<Record<string, any>> =>
  (await import(/* @vite-ignore */ new URL('../../../../client/js/trips.js', import.meta.url).href)) as Record<string, any>;
const defaultFreeSeconds = (): number => validateEnv({ DATABASE_URL: 'postgresql://x' }).FREE_RIDE_SECONDS;

describe('ride trips (server ⇄ client/js/trips.js)', () => {
  it('every trip id the server can stamp is a road the game knows, and the other way round', async () => {
    const { TRIPS } = await clientTrips();
    expect(Object.keys(TRIPS).sort()).toEqual([...TRIP_IDS].sort());
    for (const id of TRIP_IDS) expect(TRIPS[id].id).toBe(id);
  });

  it('every tier gets a trip; a new free ride is the EASY level by default, which ends itself on a straight start; classic is the road before trips', async () => {
    const { TRIPS } = await clientTrips();
    for (const tier of RIDE_TIER_IDS) expect(TRIP_IDS).toContain(TRIP_OF_TIER[tier]);
    expect(tripOf('free')).toBe('free-1');
    expect(TRIPS['free-1']).toMatchObject({ finish: true, start: 'straight' });
    expect(TRIPS.free).toMatchObject({ finish: true, start: 'straight' });
    expect(TRIPS.classic).toMatchObject({ bends: 1, traffic: 1, cross: 1, calm: false, props: 1, finish: false, start: 'depot' });
  });

  it("the old free run's offline shift in trips.js is the server's: FREE_RIDE_SECONDS' default and FREE_COMPLETE_DIST_K", async () => {
    const { TRIPS } = await clientTrips();
    expect(TRIPS.free.seconds).toBe(defaultFreeSeconds());
    expect(TRIPS.free.k).toBe(FREE_COMPLETE_DIST_K);
  });

  it("every free LEVEL row of trips.js is the server's: its level, trip, assist, and its offline shift = FREE_RIDE_SECONDS' default × the multiple at the level's K", async () => {
    const { TRIPS, FREE_LEVELS: clientLevels } = await clientTrips();
    expect(clientLevels.map((t: { id: string }) => t.id)).toEqual(FREE_LEVEL_IDS.map((l) => FREE_LEVELS[l].trip));
    for (const l of FREE_LEVEL_IDS) {
      const d = FREE_LEVELS[l], row = TRIPS[d.trip];
      expect(row, d.trip).toMatchObject({ level: l, assist: d.assist, finish: true, seconds: defaultFreeSeconds() * d.multiple, k: d.k });
    }
    // only the level rows carry a level
    expect(new Set(Object.values(TRIPS).filter((t: any) => t.level).map((t: any) => t.id))).toEqual(new Set(FREE_LEVEL_IDS.map((l) => FREE_LEVELS[l].trip)));
  });

  it('the levels: EASY ×1 K .25 with assist, CROSSROADS ×3 K .3 with assist, HARD ×10 K .4 without; EASY is the old free K', () => {
    expect(FREE_LEVEL_IDS.map((l) => [FREE_LEVELS[l].trip, FREE_LEVELS[l].name, FREE_LEVELS[l].multiple, FREE_LEVELS[l].k, FREE_LEVELS[l].assist])).toEqual([
      ['free-1', 'EASY', 1, 0.25, true], ['free-2', 'CROSSROADS', 3, 0.3, true], ['free-3', 'HARD', 10, 0.4, false],
    ]);
    expect(FREE_LEVELS[1].k).toBe(FREE_COMPLETE_DIST_K);
    expect([60, 3].flatMap((s) => FREE_LEVEL_IDS.map((l) => freeLevelSeconds(l, s)))).toEqual([60, 180, 600, 3, 9, 30]);   // a test server's short free ride scales every level
  });

  it('levelOfTrip / isFreeLevel / completedLevels / completeDistK by trip', () => {
    expect(['free-1', 'free-2', 'free-3', 'free', 'classic', '1h', null].map(levelOfTrip)).toEqual([1, 2, 3, null, null, null, null]);
    expect([1, 2, 3, 0, 4, 1.5, '1', null].map(isFreeLevel)).toEqual([true, true, true, false, false, false, false, false]);
    expect(completedLevels([{ tier: 'free', trip: 'free-3' }, { tier: 'free', trip: 'free-1' }, { tier: 'free', trip: 'free-3' }, { tier: 'free', trip: 'free' }, { tier: '1h', trip: '1h' }])).toEqual([1, 3]);
    expect([completeDistK('free', 'free-2'), completeDistK('free', 'free-3'), completeDistK('free', 'free'), completeDistK('free'), completeDistK('1h', '1h')]).toEqual([0.3, 0.4, 0.25, 0.25, 0.5]);
  });

  it('assertTutorialAllowed / assertAssistAllowed: only HARD refuses, and only with that helper on', () => {
    expect(() => assertTutorialAllowed(3, true)).toThrow(new ConflictError('the HARD free run has no tutorial', 'tutorial_not_allowed'));
    expect(() => assertAssistAllowed(3, true)).toThrow(new ConflictError('the HARD free run has no assist', 'assist_not_allowed'));
    for (const [l, on] of [[1, true], [2, true], [3, false]] as const) {
      expect(() => assertTutorialAllowed(l, on)).not.toThrow();
      expect(() => assertAssistAllowed(l, on)).not.toThrow();
    }
  });

  it('a new ride carries the trip of its tier (a free one: its level); the finish distance follows the level too', () => {
    const T0 = new Date('2026-10-10T00:00:00Z');
    const free = Ride.createFree({ id: 'r1', wallet: 'w', seed: 7, minSeconds: 60, now: T0 });
    expect(free).toMatchObject({ trip: 'free-1', level: 1, completeDist: 0.25 * 28 * 60 });
    const hard = Ride.createFree({ id: 'r2', wallet: 'w', seed: 7, minSeconds: 600, now: T0, level: 3 });
    expect(hard).toMatchObject({ trip: 'free-3', level: 3, completeDist: 0.4 * 28 * 600 });
  });
});
