import { FREE_LEVELS, levelOfTrip } from './ride-trip.js';

/* The ride rules that must stay identical to the game client (client/js/config.js) and to what the server judges a shift by. */
export const MAX_SPEED = 28; // m/s – CFG.MAX_SPEED, the game's governor
export const COMPLETE_DIST_K = 0.5; // CFG.COMPLETE_DIST_K: complete = minSeconds driven AND K × MAX_SPEED × minSeconds metres

/** Theme ids of client/js/themes/* – a ride's route (worldFor) is one of these; the analytics only ever carry an id from this list. */
export const ROUTE_IDS = ['route66', 'stuart', 'siberia', 'brenner', 'panamerican'] as const;
export type RouteId = (typeof ROUTE_IDS)[number];
/** A ride's WORLD – the route it is driven on and the clock hour it starts at – is decided by the SERVER when the ride is created, from its seed, and is never taken from the client
    (no picker in the game; heartbeats cannot change it). Hours: dawn · noon · dusk · night, so every kind of light comes round. The game applies exactly these (RideDto.route / startHour). */
export const START_HOURS = [6.5, 12, 18.5, 22] as const;
export const worldFor = (seed: number): { route: RouteId; startHour: number } => ({
  route: ROUTE_IDS[seed % ROUTE_IDS.length] as RouteId,
  startHour: START_HOURS[Math.floor(seed / ROUTE_IDS.length) % START_HOURS.length] as number,
});
export const isRouteId = (v: unknown): v is RouteId => typeof v === 'string' && (ROUTE_IDS as readonly string[]).includes(v);

export const SPEED_SLACK = 1.2; // Δs may be up to MAX_SPEED·Δt·SPEED_SLACK + SLACK_METRES
export const SLACK_METRES = 20;
export const MAX_REPORTED_DISTANCE = 1e7; // metres – anything beyond is garbage
export const DRIVE_CREDIT_SLACK = 1.05; // the game clock may run ≤ 5 % (+ 1 s) ahead of the server's wall clock between two reports
export const DRIVE_CREDIT_SLACK_SECONDS = 1;
export const REASON_MAX_LENGTH = 200;
/** a ride never reports more crashes than this (the counters feed the public statistics, so a hostile client cannot inflate them without bound) */
export const MAX_CRASHES_PER_RIDE = 200;
/** … and never more than a plausible rate: 3 plus one per 3 driven seconds (a truck cannot crash ten times a second) */
export const crashCap = (driveSeconds: number): number => Math.min(MAX_CRASHES_PER_RIDE, 3 + Math.floor(Math.max(0, driveSeconds) / 3));

/** The FREE run ends at a shorter line: its minute is mostly the depot road and the turn, and a brisk driver covers ~490 m of it (the trip-design
    skill's measure), so the paid K of 0.5 (840 m) would stretch "one minute" to ~95 s. Stored on the ride at creation, so changing it moves only new rides.
    This is the old 'free' trip's and the EASY level's (and the offline run's) K; each free LEVEL has its own (ride-trip.ts FREE_LEVELS – level 1 = this). */
export const FREE_COMPLETE_DIST_K = 0.25;
/** ASSIST (a free ride's helper): the truck loses this share of the hull it would lose otherwise – CFG.ASSIST.HULL_DMG in client/js/config.js (drift-tested in world-checks.spec.ts). The verdict still passes an honest assisted drive only while this stays above PASS_DAMAGE_SHARE. */
export const ASSIST_HULL_DAMAGE = 0.5;
/** the finish-line K of a NEW ride: a free LEVEL's own K (by its trip), else the free run's or the paid one by tier */
export const completeDistK = (tier: string, trip: string | null = null): number => {
  const level = levelOfTrip(trip);
  if (level !== null) return FREE_LEVELS[level].k;
  return tier === 'free' ? FREE_COMPLETE_DIST_K : COMPLETE_DIST_K;
};
export const completeDist = (minSeconds: number, k: number = COMPLETE_DIST_K): number => k * MAX_SPEED * minSeconds;

/** Timing knobs the environment may tune (see RulesConfigPort). */
export interface RideTimingRules {
  /** no heartbeat for this long = the tab is gone: the ride fails */
  hbTimeoutMs: number;
  /** heartbeats closer together than this are ignored (no free progress by spamming) */
  hbMinIntervalMs: number;
}
