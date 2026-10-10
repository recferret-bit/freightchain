import type { Loadout } from '../economy/cosmetics.js';
import { reviewOf, type RideReview } from '../verdict/ride-review.js';
import type { VerdictDto } from '../verdict/verdict.dto.js';
import { toChallengeDto, type ChallengeDto } from './ride-challenge.js';
import type { Ride } from './ride.entity.js';
import { RideStatus } from './ride-status.js';
import type { FreeLevel } from './ride-trip.js';

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
  /** the free LEVEL (1 EASY · 2 CROSSROADS · 3 HARD – ride-trip.ts FREE_LEVELS), from the trip; null = a paid ride or a free one from before the levels */
  level: number | null;
  /** the world the SERVER assigned at creation (from the seed): the route id and the clock hour the game starts at – the game applies them, nothing in it can change them (null = a ride from before this) */
  route: string | null;
  startHour: number | null;
  /** a free ride's helpers (false on every paid one): the tutorial dialog, and ASSIST = half the wear + a tip on every control – the game reads both from here */
  tutorial: boolean;
  assist: boolean;
  /** the server's check of the recording (verified play); null = not judged – only completed shifts are */
  verdict: VerdictDto | null;
  /** a PAID ride's review (domain/verdict/ride-review.ts): 'under_review' until the machine checks verify it or an admin decides – 'accepted' /
      'rejected'; null for free rides and for rides that did not complete. Derived from `verdict` (a completed paid ride shown without one = under_review). */
  review: RideReview | null;
  /** the challenge whose window is open right now (the heartbeat response carries it; null elsewhere). Kinds live in CHALLENGE_KINDS, empty today. */
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
  level: r.level,
  route: r.route,
  startHour: r.startHour,
  tutorial: r.tutorial,
  assist: r.assist,
  verdict,
  review: reviewOf(r.tier, verdict ? { status: verdict.status, overridden: verdict.override !== null } : null, r.status),
  challenge: now ? (() => { const c = r.openChallenge(now); return c ? toChallengeDto(c) : null; })() : null,
});

/** The wallet's READY free ride (ordered, not started – its credit is already spent): ordering a free ride again hands it back, re-chosen at the level and
    helpers asked for, without a credit (create-ride.handler.ts). /api/me carries it so the lobby keeps START on at 0 credits. */
export interface ReadyFreeRideDto {
  id: string;
  /** 1 EASY · 2 CROSSROADS · 3 HARD; null = a free ride from before the levels */
  level: FreeLevel | null;
  trip: string | null;
  tutorial: boolean;
  assist: boolean;
}

/** the ready free ride among the wallet's rides in hand, or null */
export const readyFreeRideOf = (open: readonly Ride[]): ReadyFreeRideDto | null => {
  const r = open.find((x) => x.isFree && x.isInStatus(RideStatus.Created));
  return r ? { id: r.id, level: r.level, trip: r.trip, tutorial: r.tutorial, assist: r.assist } : null;
};

/** The ride that is still owed to the wallet, or null (GET /api/rides/pending). */
export interface PendingRideDto {
  ride: RideDto | null;
}
