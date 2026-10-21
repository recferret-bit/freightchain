import { FREE_LEVEL_IDS, FREE_LEVELS } from './ride-trip.js';

/* The ride rules that must stay identical to the game client (client/js/config.js) and to what the server judges a shift by. */
export const MAX_SPEED = 28; // m/s – CFG.MAX_SPEED, the game's governor
export const COMPLETE_DIST_K = 0.5; // CFG.COMPLETE_DIST_K: complete = K × MAX_SPEED × minSeconds metres covered (minSeconds is the nominal shift length – no minimum time any more)

/** Theme ids of client/js/themes/* – a ride's route (worldFor) is one of these; the analytics only ever carry an id from this list. */
export const ROUTE_IDS = ['route66', 'stuart', 'siberia', 'brenner', 'panamerican'] as const;
export type RouteId = (typeof ROUTE_IDS)[number];
/** A PAID ride's route, and EVERY ride's clock hour, are decided by the SERVER when the ride is created, from its seed, and are never taken from the client
    (no picker in the game; heartbeats cannot change them). A FREE ride's route is its level's country instead (ride-trip.ts FREE_LEVELS.route) – the hour is still this.
    Hours: dawn · noon · dusk · night, so every kind of light comes round. The game applies exactly these (RideDto.route / startHour). */
export const START_HOURS = [6.5, 12, 18.5, 22] as const;
export const worldFor = (seed: number): { route: RouteId; startHour: number } => ({
  route: ROUTE_IDS[seed % ROUTE_IDS.length] as RouteId,
  startHour: START_HOURS[Math.floor(seed / ROUTE_IDS.length) % START_HOURS.length] as number,
});
export const isRouteId = (v: unknown): v is RouteId => typeof v === 'string' && (ROUTE_IDS as readonly string[]).includes(v);

export const SPEED_SLACK = 1.2; // Δs may be up to MAX_SPEED·Δt·SPEED_SLACK + SLACK_METRES (per beat: the slack absorbs network jitter between two beats' arrivals)
export const SLACK_METRES = 20;
/** …and the whole ride, so beats 1 s apart cannot each add the slack (audit H3: 1.9× the governor): s ≤ MAX_SPEED × RIDE_SPEED_SLACK × wall seconds since the start + RIDE_SLACK_METRES (pauses only loosen it) */
export const RIDE_SPEED_SLACK = 1.05;
export const RIDE_SLACK_METRES = 50;
/** per beat against the game's own clock: Δs ≤ MAX_SPEED × GAME_SPEED_SLACK × Δt(game) + GAME_SLACK_METRES – a clock that stands still while s moves
    (audit S4-10) fails. The game integrates s from v over the same clock; the slack covers the inside of a curve (ds = v·cosψ / (1 − k·d)), a fork's road
    switch and a car pushing the truck */
export const GAME_SPEED_SLACK = 1.1;
export const GAME_SLACK_METRES = 10;
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
    This is the old 'free' trip's and the offline guest run's K; each free LEVEL has its own (ride-trip.ts FREE_LEVELS – EASY .3 since 2026-10-11). */
export const FREE_COMPLETE_DIST_K = 0.25;
/** ASSIST (a free ride's helper): the truck loses this share of the hull it would lose otherwise – CFG.ASSIST.HULL_DMG in client/js/config.js (drift-tested in world-checks.spec.ts). The verdict still passes an honest assisted drive only while this stays above PASS_DAMAGE_SHARE. */
export const ASSIST_HULL_DAMAGE = 0.5;
/** the finish-line K of a NEW ride: a current free LEVEL's own K (by its trip), else the free run's or the paid one by tier. A retired level trip (free-1b…)
    does not get its level's K today – an existing ride's line is its stored completeDist, never this */
export const completeDistK = (tier: string, trip: string | null = null): number => {
  const level = FREE_LEVEL_IDS.find((l) => FREE_LEVELS[l].trip === trip);
  if (level !== undefined) return FREE_LEVELS[level].k;
  return tier === 'free' ? FREE_COMPLETE_DIST_K : COMPLETE_DIST_K;
};
export const completeDist = (minSeconds: number, k: number = COMPLETE_DIST_K): number => k * MAX_SPEED * minSeconds;
/** A 1h shift that is still running after this much wall-clock time is a timeout, not a finish (90 minutes). */
export const T_CAP_SECONDS = 5400;

/** Timing knobs the environment may tune (see RulesConfigPort). */
export interface RideTimingRules {
  /** no heartbeat for this long = the tab is gone: the ride fails */
  hbTimeoutMs: number;
  /** heartbeats closer together than this are ignored (no free progress by spamming) */
  hbMinIntervalMs: number;
}
