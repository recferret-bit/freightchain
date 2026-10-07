import type { Ride } from './ride.entity.js';

/** The wire view of a ride. Timestamps are epoch milliseconds. `timeScale` > 1 marks a DEMO ride (the shift is that many times shorter). */
export interface RideDto {
  id: string;
  tier: string;
  seed: number;
  status: string;
  minSeconds: number;
  completeDist: number;
  timeScale: number;
  priceUsd: number;
  lamports: number;
  quoteExpiresAt: number | null;
  roundId: number | null;
  /** the prize pool whose ticket paid for it (null = free or a legacy order) */
  poolId: number | null;
  driveSeconds: number;
  distance: number;
  reason: string | null;
}

export const toRideDto = (r: Ride): RideDto => ({
  id: r.id,
  tier: r.tier,
  seed: r.seed,
  status: r.status,
  minSeconds: r.minSeconds,
  completeDist: r.completeDist,
  timeScale: r.timeScale,
  priceUsd: r.priceUsd,
  lamports: r.lamports,
  quoteExpiresAt: r.quoteExpiresAt?.getTime() ?? null,
  roundId: r.roundId,
  poolId: r.poolId,
  driveSeconds: Math.round(r.driveSeconds * 10) / 10,
  distance: Math.round(r.distance),
  reason: r.reason,
});

/** The ride that is still owed to the wallet, or null (GET /api/rides/pending). */
export interface PendingRideDto {
  ride: RideDto | null;
}
