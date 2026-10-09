import { ConflictError } from '../shared/errors.js';
import type { RideTierId } from './ride-tier.js';

/* The ROAD a ride is driven on – an id of client/js/trips.js TRIPS: how much it bends, how much traffic, the free run's straight start and its ending at
   the line. The game draws and drives it; the server judges none of it (the layout and the holes are the seed's – domain/road). Stamped on the ride when
   it is CREATED (Ride.trip), so a replay rebuilds the road the driver had however the table is tuned later: a trip id is FROZEN once rides carry it –
   retune by adding a new id (here and in trips.js) and pointing the tier at it. null on a ride = one from before trips: the 'classic' road.
   test/unit/domain/ride-trip.spec.ts holds this list and the client's table together. */
export const TRIP_IDS = ['classic', 'free', 'free-1', 'free-2', 'free-3', '1h', '4h', '8h'] as const;
export type TripId = (typeof TRIP_IDS)[number];

/* The FREE ride's three LEVELS (the lobby's picker): each its own trip, its own shift length and finish line, and whether ASSIST may be on.
   The shift is FREE_RIDE_SECONDS (env, default 60) × `multiple`, so a test server's short free ride scales every level alike; the finish line is
   k × MAX_SPEED × that (ride-rules.ts completeDist). Stored on the ride at creation (trip, minSeconds, completeDist) – changing a row moves only new rides,
   and a row's trip id is frozen like any other. 'free' (the one free trip before the levels) has no level. */
export const FREE_LEVEL_IDS = [1, 2, 3] as const;
export type FreeLevel = (typeof FREE_LEVEL_IDS)[number];
export interface FreeLevelDef {
  level: FreeLevel;
  trip: TripId;
  /** the lobby's name of the level (EASY / CROSSROADS / HARD) */
  name: string;
  /** × FREE_RIDE_SECONDS = the shift length */
  multiple: number;
  /** the finish line: k × MAX_SPEED × the shift length */
  k: number;
  /** may the ride be ordered with ASSIST on (false = refused, 409) */
  assist: boolean;
}
export const FREE_LEVELS: Readonly<Record<FreeLevel, FreeLevelDef>> = {
  1: { level: 1, trip: 'free-1', name: 'EASY', multiple: 1, k: 0.25, assist: true },
  2: { level: 2, trip: 'free-2', name: 'CROSSROADS', multiple: 3, k: 0.3, assist: true },
  3: { level: 3, trip: 'free-3', name: 'HARD', multiple: 10, k: 0.4, assist: false },
};
export const DEFAULT_FREE_LEVEL: FreeLevel = 1;
export const isFreeLevel = (v: unknown): v is FreeLevel => typeof v === 'number' && (FREE_LEVEL_IDS as readonly number[]).includes(v);
/** a free level's shift length, from the configured FREE_RIDE_SECONDS */
export const freeLevelSeconds = (level: FreeLevel, freeRideSeconds: number): number => freeRideSeconds * FREE_LEVELS[level].multiple;
/** ASSIST is refused (409 `assist_not_allowed`) on a free level that does not allow it (HARD) – it would halve the wear on the hardest run */
export function assertAssistAllowed(level: FreeLevel, assist: boolean): void {
  const def = FREE_LEVELS[level];
  if (assist && !def.assist) throw new ConflictError(`the ${def.name} free run has no assist`, 'assist_not_allowed');
}
/** the free level a ride's trip is (null = a paid trip, the old 'free' trip, classic, or no trip) */
export const levelOfTrip = (trip: string | null): FreeLevel | null => FREE_LEVEL_IDS.find((l) => FREE_LEVELS[l].trip === trip) ?? null;

/** the trip a NEW ride of this tier is driven on (a free ride: its level's – level 1 unless the lobby picked another) */
export const TRIP_OF_TIER: Readonly<Record<RideTierId, TripId>> = { free: FREE_LEVELS[DEFAULT_FREE_LEVEL].trip, '1h': '1h', '4h': '4h', '8h': '8h' };
export const tripOf = (tier: RideTierId): TripId => TRIP_OF_TIER[tier];
