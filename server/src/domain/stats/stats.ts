import { RideStatus } from '../rides/ride-status.js';
import type { RideProps } from '../rides/ride.entity.js';

/** The core metrics, as running totals (per rider and for the whole game) – docs/statistics.md. Metres and seconds are what was really driven. */
export interface StatsTotals {
  /** started rides that ended, whatever the outcome */
  rides: number;
  /** … of which free rides (tier `free`: the daily credits and promo rides) */
  ridesFree: number;
  /** … of which paid rides (a ticket / paid shift) – `rides` = `ridesFree` + `ridesPaid` */
  ridesPaid: number;
  /** … of which complete shifts */
  ridesCompleted: number;
  /** driven (game) seconds */
  seconds: number;
  metres: number;
  /** truck ⇄ vehicle contacts, bumps included */
  crashesVehicle: number;
  /** truck ⇄ building crashes (always fatal) */
  crashesBuilding: number;
  /** donations that landed on a stream (mock + paid) */
  donations: number;
  /** lamports of the PAID donations only – money that moved */
  donationLamports: number;
}

export const EMPTY_STATS: Readonly<StatsTotals> = Object.freeze({
  rides: 0, ridesFree: 0, ridesPaid: 0, ridesCompleted: 0, seconds: 0, metres: 0, crashesVehicle: 0, crashesBuilding: 0, donations: 0, donationLamports: 0,
});

/** The rides that count: started, and over for good. A ride that never started (free credit refunded, an unpaid order) never drove anywhere. */
export function countsForStats(ride: Pick<RideProps, 'status' | 'startedAt'>): boolean {
  return ride.startedAt !== null && (ride.status === RideStatus.Completed || ride.status === RideStatus.Abandoned || ride.status === RideStatus.Failed);
}

/** What one ride that just ended adds to the totals (null = it does not count). */
export function rideDelta(ride: RideProps): StatsTotals | null {
  if (!countsForStats(ride)) return null;
  return {
    rides: 1, ridesFree: ride.tier === 'free' ? 1 : 0, ridesPaid: ride.tier === 'free' ? 0 : 1, ridesCompleted: ride.status === RideStatus.Completed ? 1 : 0, seconds: Math.max(0, ride.driveSeconds), metres: Math.max(0, ride.lastS),
    crashesVehicle: ride.crashesVehicle, crashesBuilding: ride.crashesBuilding, donations: 0, donationLamports: 0,
  };
}

/** What one donation on a stream adds: it always counts as a donation, its lamports only when a real transfer paid it. */
export function donationDelta(lamports: number, paid: boolean): StatsTotals {
  return { ...EMPTY_STATS, donations: 1, donationLamports: paid ? Math.max(0, Math.floor(lamports)) : 0 };
}

export function addStats(a: StatsTotals, b: StatsTotals): StatsTotals {
  return {
    rides: a.rides + b.rides, ridesFree: a.ridesFree + b.ridesFree, ridesPaid: a.ridesPaid + b.ridesPaid, ridesCompleted: a.ridesCompleted + b.ridesCompleted, seconds: a.seconds + b.seconds, metres: a.metres + b.metres,
    crashesVehicle: a.crashesVehicle + b.crashesVehicle, crashesBuilding: a.crashesBuilding + b.crashesBuilding,
    donations: a.donations + b.donations, donationLamports: a.donationLamports + b.donationLamports,
  };
}

/** The wire shape: whole numbers (seconds and metres rounded), `crashes` = both kinds. */
export interface StatsDto {
  rides: number;
  ridesFree: number;
  ridesPaid: number;
  ridesCompleted: number;
  seconds: number;
  metres: number;
  crashes: number;
  crashesVehicle: number;
  crashesBuilding: number;
  donations: number;
  donationLamports: number;
}

export function toStatsDto(s: StatsTotals): StatsDto {
  return {
    rides: s.rides, ridesFree: s.ridesFree, ridesPaid: s.ridesPaid, ridesCompleted: s.ridesCompleted, seconds: Math.round(s.seconds), metres: Math.round(s.metres),
    crashes: s.crashesVehicle + s.crashesBuilding, crashesVehicle: s.crashesVehicle, crashesBuilding: s.crashesBuilding,
    donations: s.donations, donationLamports: s.donationLamports,
  };
}

/** The public numbers: the game's totals plus how many riders have a ride behind them. */
export interface GlobalStatsDto extends StatsDto {
  drivers: number;
  /** epoch ms the totals were last written (0 = never) */
  updatedAt: number;
}

/** The `stats:reconcile` verdict for one row: what is stored vs what the rides and the feed say. */
export const STATS_FIELDS = ['rides', 'ridesFree', 'ridesPaid', 'ridesCompleted', 'seconds', 'metres', 'crashesVehicle', 'crashesBuilding', 'donations', 'donationLamports'] as const;
export type StatsField = (typeof STATS_FIELDS)[number];
/** seconds and metres are floats summed in a different order by the database: a difference under this is rounding, not drift */
export const STATS_FLOAT_TOLERANCE = 0.01;

export function statsDrift(stored: StatsTotals, truth: StatsTotals): Partial<Record<StatsField, { stored: number; truth: number }>> {
  const out: Partial<Record<StatsField, { stored: number; truth: number }>> = {};
  for (const f of STATS_FIELDS) if (Math.abs(stored[f] - truth[f]) > STATS_FLOAT_TOLERANCE) out[f] = { stored: stored[f], truth: truth[f] };
  return out;
}
