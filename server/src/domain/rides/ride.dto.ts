import type { Loadout } from '../economy/cosmetics.js';
import type { VerdictDto } from '../verdict/verdict.dto.js';
import { toChallengeDto, type ChallengeDto } from './ride-challenge.js';
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
  /** what the driver wore when the ride started (null = not started yet / all classic) – the game wears it */
  loadout: Loadout | null;
  /** the road it is driven on (a client/js/trips.js id; null = a ride from before trips: 'classic') – the game builds it before the menu */
  trip: string | null;
  /** the server's check of the recording (verified play); null = not judged – only completed shifts are */
  verdict: VerdictDto | null;
  /** the dispatch prompt whose window is open right now (the heartbeat response carries it; null elsewhere) */
  challenge: ChallengeDto | null;
}

/** `now`: when given, the open prompt is included (the heartbeat); without it the DTO never carries one. */
export const toRideDto = (r: Ride, verdict: VerdictDto | null = null, now: Date | null = null): RideDto => ({
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
  loadout: r.loadout,
  trip: r.trip,
  verdict,
  challenge: now ? (() => { const c = r.openChallenge(now); return c ? toChallengeDto(c) : null; })() : null,
});

/** The ride that is still owed to the wallet, or null (GET /api/rides/pending). */
export interface PendingRideDto {
  ride: RideDto | null;
}
