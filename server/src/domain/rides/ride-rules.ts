/* The ride rules that must stay identical to the game client (client/js/config.js) and to what the server judges a shift by. */
export const MAX_SPEED = 28; // m/s – CFG.MAX_SPEED, the game's governor
export const COMPLETE_DIST_K = 0.5; // CFG.COMPLETE_DIST_K: complete = minSeconds driven AND K × MAX_SPEED × minSeconds metres

/** Theme ids of client/js/themes/* – a heartbeat's route is whitelisted against this (it ends up in a public feed). */
export const ROUTE_IDS = ['route66', 'stuart', 'siberia', 'brenner', 'panamerican'] as const;
export type RouteId = (typeof ROUTE_IDS)[number];
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

export const completeDist = (minSeconds: number): number => COMPLETE_DIST_K * MAX_SPEED * minSeconds;

/** Timing knobs the environment may tune (see RulesConfigPort). */
export interface RideTimingRules {
  /** no heartbeat for this long = the tab is gone: the ride fails */
  hbTimeoutMs: number;
  /** heartbeats closer together than this are ignored (no free progress by spamming) */
  hbMinIntervalMs: number;
}
