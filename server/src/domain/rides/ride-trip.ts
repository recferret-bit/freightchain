import { ConflictError } from '../shared/errors.js';
import type { RideTierId } from './ride-tier.js';

/* The ROAD a ride is driven on – an id of client/js/trips.js TRIPS: how much it bends, how much traffic, the free run's straight start and its ending at
   the line. The game draws and drives it; the server judges only its layout knobs (domain/road road-rules.ts TRIP_ROADS / TRIP_HOLE_FIRST: patterns, holes – the bends, traffic and scenery are the game's alone). Stamped on the ride when
   it is CREATED (Ride.trip), so a replay rebuilds the road the driver had however the table is tuned later: a trip id is FROZEN once rides carry it –
   retune by adding a new id (here and in trips.js) and pointing the tier at it. null on a ride = one from before trips: the 'classic' road.
   test/unit/domain/ride-trip.spec.ts holds this list and the client's table together. */
export const TRIP_IDS = ['classic', 'free', 'free-1', 'free-2', 'free-3', 'free-g', 'free-1b', 'free-2b', 'free-3b', 'free-1c', 'free-2c', '1h', '4h', '8h'] as const;
export type TripId = (typeof TRIP_IDS)[number];
/** the longest trip id a request may name (POST /api/rides/:id/start `trip`) – the ids above are far shorter */
export const TRIP_ID_MAX_LENGTH = 32;
/** the trip a ride is driven on – null (a ride from before trips) is the 'classic' road */
export const tripOrClassic = (trip: string | null): string => trip ?? 'classic';

/* The FREE ride's three LEVELS (the lobby's picker): each its own trip, its own shift length and finish line, and whether ASSIST may be on.
   The shift is FREE_RIDE_SECONDS (env, default 180 = the EASY level's length) × `multiple`, so a test server's short free ride scales every level alike; the finish line is
   k × MAX_SPEED × that (ride-rules.ts completeDist). Stored on the ride at creation (trip, minSeconds, completeDist) – changing a row moves only new rides,
   and a row's trip id is frozen like any other. 'free' (the one free trip before the levels) has no level. The levels were retuned (2026-10-11: 3 / 6 / 15
   minutes – FREE_RIDE_SECONDS 60 → 180, multiples 1 / 3 / 10 → 1 / 2 / 5, exact crossroads counts) on NEW trip ids – 'free-1b' / '-2b' / '-3b'; the rides on 'free-1' / '-2' / '-3' keep their road and their level (LEGACY_FREE_TRIPS),
   but they rank on no board any more (a board lists one trip). Third round (2026-10-11): EASY 'free-1c' 3 min at K .3 (two crossroads), MEDIUM (was CROSSROADS) 'free-2c'
   5 min (× 5/3, rounded) – 'free-1b' / '-2b' join the legacy ids; HARD keeps 'free-3b'. 'free-g' is the offline guest run: never stamped on a ride. */
export const FREE_LEVEL_IDS = [1, 2, 3] as const;
export type FreeLevel = (typeof FREE_LEVEL_IDS)[number];
export interface FreeLevelDef {
  level: FreeLevel;
  trip: TripId;
  /** the lobby's name of the level (EASY / MEDIUM / HARD) */
  name: string;
  /** × FREE_RIDE_SECONDS = the shift length (rounded to whole seconds) */
  multiple: number;
  /** the finish line: k × MAX_SPEED × the shift length */
  k: number;
  /** may the ride be ordered with the TUTORIAL on (false = refused, 409) */
  tutorial: boolean;
  /** may the ride be ordered with ASSIST on (false = refused, 409) */
  assist: boolean;
  /** the country this level is driven in – a theme id (client/js/themes, ride-rules.ts ROUTE_IDS). Fixed, not drawn from the seed.
      The lobby's copy of the same three ids is client/js/free-countries.js (ride-trip.spec.ts holds them together). */
  route: 'stuart' | 'route66' | 'brenner';
}
export const FREE_LEVELS: Readonly<Record<FreeLevel, FreeLevelDef>> = {
  1: { level: 1, trip: 'free-1c', name: 'EASY', multiple: 1, k: 0.3, tutorial: true, assist: true, route: 'stuart' },
  2: { level: 2, trip: 'free-2c', name: 'MEDIUM', multiple: 5 / 3, k: 0.4, tutorial: true, assist: true, route: 'route66' },
  3: { level: 3, trip: 'free-3b', name: 'HARD', multiple: 5, k: 0.4, tutorial: false, assist: false, route: 'brenner' },
};
/** the retired levels (the first round 1 / 3 / 10 min, the second round's EASY 3 min and CROSSROADS 6 min): rides that carry these trips keep their level – history, profile, achievements – but are not on the boards */
export const LEGACY_FREE_TRIPS: Readonly<Record<string, FreeLevel>> = { 'free-1': 1, 'free-2': 2, 'free-3': 3, 'free-1b': 1, 'free-2b': 2 };
export const DEFAULT_FREE_LEVEL: FreeLevel = 1;
export const isFreeLevel = (v: unknown): v is FreeLevel => typeof v === 'number' && (FREE_LEVEL_IDS as readonly number[]).includes(v);
/** a free level's shift length, from the configured FREE_RIDE_SECONDS */
export const freeLevelSeconds = (level: FreeLevel, freeRideSeconds: number): number => Math.round(freeRideSeconds * FREE_LEVELS[level].multiple);
/** TUTORIAL is refused (409 `tutorial_not_allowed`) on a free level that does not allow it (HARD) – the dialog holds the finish line */
export function assertTutorialAllowed(level: FreeLevel, tutorial: boolean): void {
  const def = FREE_LEVELS[level];
  if (tutorial && !def.tutorial) throw new ConflictError(`the ${def.name} free run has no tutorial`, 'tutorial_not_allowed');
}
/** ASSIST is refused (409 `assist_not_allowed`) on a free level that does not allow it (HARD) – it would halve the wear on the hardest run */
export function assertAssistAllowed(level: FreeLevel, assist: boolean): void {
  const def = FREE_LEVELS[level];
  if (assist && !def.assist) throw new ConflictError(`the ${def.name} free run has no assist`, 'assist_not_allowed');
}
/** the free level a ride's trip is (null = a paid trip, the old 'free' trip, classic, or no trip) */
export const levelOfTrip = (trip: string | null): FreeLevel | null => FREE_LEVEL_IDS.find((l) => FREE_LEVELS[l].trip === trip) ?? (trip !== null ? LEGACY_FREE_TRIPS[trip] : undefined) ?? null;
/** the free levels these (completed) rides cleared, ascending, each once – the achievements' fact */
export const completedLevels = (rides: readonly { tier: string; trip: string | null }[]): FreeLevel[] =>
  FREE_LEVEL_IDS.filter((l) => rides.some((r) => r.tier === 'free' && levelOfTrip(r.trip) === l));

/** the trip a NEW ride of this tier is driven on (a free ride: its level's – level 1 unless the lobby picked another) */
export const TRIP_OF_TIER: Readonly<Record<RideTierId, TripId>> = { free: FREE_LEVELS[DEFAULT_FREE_LEVEL].trip, '1h': '1h', '4h': '4h', '8h': '8h' };
export const tripOf = (tier: RideTierId): TripId => TRIP_OF_TIER[tier];
