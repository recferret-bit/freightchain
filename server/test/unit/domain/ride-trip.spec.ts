import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { RIDE_TIER_IDS } from '../../../src/domain/rides/ride-tier.js';
import { TRIP_IDS, TRIP_OF_TIER, tripOf } from '../../../src/domain/rides/ride-trip.js';
import { FREE_COMPLETE_DIST_K } from '../../../src/domain/rides/ride-rules.js';
import { validateEnv } from '../../../src/infrastructure/config/env.schema.js';

/* The server stamps a trip id on every new ride (ride-trip.ts); the game builds that road from client/js/trips.js – the two lists must be the same,
   and the free run's offline shift in trips.js must be the one the server hands out. */
const clientTrips = async (): Promise<Record<string, any>> =>
  (await import(/* @vite-ignore */ new URL('../../../../client/js/trips.js', import.meta.url).href)) as Record<string, any>;

describe('ride trips (server ⇄ client/js/trips.js)', () => {
  it('every trip id the server can stamp is a road the game knows, and the other way round', async () => {
    const { TRIPS } = await clientTrips();
    expect(Object.keys(TRIPS).sort()).toEqual([...TRIP_IDS].sort());
    for (const id of TRIP_IDS) expect(TRIPS[id].id).toBe(id);
  });

  it('every tier gets a trip; the free run is the free trip that ends itself, on a straight start; classic is the road before trips', async () => {
    const { TRIPS } = await clientTrips();
    for (const tier of RIDE_TIER_IDS) expect(TRIP_IDS).toContain(TRIP_OF_TIER[tier]);
    expect(tripOf('free')).toBe('free');
    expect(TRIPS.free).toMatchObject({ finish: true, start: 'straight' });
    expect(TRIPS.classic).toMatchObject({ bends: 1, traffic: 1, cross: 1, calm: false, props: 1, finish: false, start: 'depot' });
  });

  it("the free run's offline shift in trips.js is the server's: FREE_RIDE_SECONDS' default and FREE_COMPLETE_DIST_K", async () => {
    const { TRIPS } = await clientTrips();
    expect(TRIPS.free.seconds).toBe(validateEnv({ DATABASE_URL: 'postgresql://x' }).FREE_RIDE_SECONDS);
    expect(TRIPS.free.k).toBe(FREE_COMPLETE_DIST_K);
  });

  it('a new ride carries the trip of its tier; the finish distance follows the tier too', () => {
    const T0 = new Date('2026-10-10T00:00:00Z');
    const free = Ride.createFree({ id: 'r1', wallet: 'w', seed: 7, minSeconds: 60, now: T0 });
    expect(free.trip).toBe('free');
    expect(free.completeDist).toBe(0.25 * 28 * 60);
  });
});
