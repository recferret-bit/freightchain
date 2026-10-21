/** Who may see a finished ride as a public replay. Training and a ride still on the road are never public (RPL-M-01..05). */

export interface ReplaySubject {
  status: string;
  tier: string;
  tutorial: boolean;
  assist: boolean;
  /** the driver's player row is an anonymous guest session */
  guest: boolean;
  wallet: string;
  poolId: number | null;
  /** the pool's review end. Null when the ride has no pool, or the pool row is missing. */
  payoutAt: Date | null;
  /** null = not judged yet. `rejected` stays off every public surface. */
  verdict: string | null;
}

export type ReplayDenyCode = 'replay_not_available' | 'replay_locked_until_payout';

const FINISHED = new Set(['completed', 'abandoned', 'failed']);

export const isTrainingRide = (ride: Pick<ReplaySubject, 'tier' | 'tutorial' | 'assist' | 'guest'>): boolean =>
  ride.tier === 'free' || ride.tutorial || ride.assist || ride.guest;

/** Null = the caller may open the replay. A running ride is hidden from everyone, including its driver. */
export function replayDenial(ride: ReplaySubject, caller: string | null, now: Date): { code: ReplayDenyCode; message: string } | null {
  if (ride.status === 'running' || ride.status === 'created') return { code: 'replay_not_available', message: 'replay is not available' };
  if (isTrainingRide(ride) || ride.verdict === 'rejected' || !FINISHED.has(ride.status)) return { code: 'replay_not_available', message: 'replay is not available' };
  const locked = ride.poolId !== null && (ride.payoutAt === null || ride.payoutAt.getTime() > now.getTime());
  if (locked && caller !== ride.wallet) return { code: 'replay_locked_until_payout', message: 'replay is locked until the pool pays out' };
  return null;
}

/** A row of the public replays board: a finished 1h ride that `replayDenial` would open for `viewer`. */
export function isPublicReplay(ride: ReplaySubject, now: Date, viewer: string | null): boolean {
  if (ride.tier !== '1h') return false;
  return replayDenial(ride, viewer, now) === null;
}
