import type { Facts } from '../../../domain/achievements/achievements.js';
import type { LeaderboardBoard, LeaderboardSort } from '../../../domain/economy/economy.dto.js';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';

export interface LiveRideRow {
  id: string;
  wallet: string;
  tier: string;
  route: string | null;
  minSeconds: number;
  completeDist: number;
  driveSeconds: number;
  lastS: number;
  hull: number | null;
  paused: boolean;
  timeScale: number;
  startedAt: Date;
  lastHbAt: Date;
}

/** A paid shift that is bought but not started yet – the landing's "next up" board. */
export interface UpcomingRideRow {
  wallet: string;
  tier: string;
  minSeconds: number;
  paidAt: Date;
}

/** A ride that ended (completed, abandoned or failed) – the landing's ticker. */
export interface FinishedRideRow {
  id: string;
  wallet: string;
  tier: string;
  route: string | null;
  status: string;
  lastS: number;
  endedAt: Date | null;
  poolId?: number | null;
  /** the pool's review end, when `poolId` is set */
  payoutAt?: Date | null;
}

/** One ended ride in the replays history. `seq` is the insertion order – with endedAt, the stable cursor. */
export interface HistoryRideRow {
  id: string;
  seq: bigint;
  wallet: string;
  tier: string;
  route: string | null;
  status: string;
  reason: string | null;
  lastS: number;
  driveSeconds: number;
  minSeconds: number;
  timeScale: number;
  startedAt: Date;
  endedAt: Date;
  /** its recording is still kept (a replay exists) */
  recorded: boolean;
}

export interface HistoryFilter {
  /** only rides that ended before this point (the previous page's last row) */
  before: { endedAt: Date; seq: bigint } | null;
  limit: number;
  wallet: string | null;
  status: 'completed' | 'abandoned' | 'failed' | null;
  /** the public board: finished 1h replays only. `viewerWallet` still sees their own pool ride before payout. */
  board?: { now: Date; viewerWallet: string | null };
}

export interface RideStatsRow {
  started: number;
  completed: number;
  metres: number;
  best: number;
}

/** Everything the profile and the achievement rules need about a wallet's rides, in one read. */
export interface RideSummary {
  facts: Facts;
  stats: RideStatsRow;
}

export interface RecentRideRow {
  tier: string;
  status: string;
  lastS: number;
  hull: number | null;
  route: string | null;
  timeScale: number;
  startedAt: Date;
  endedAt: Date | null;
  /** the verdict's status (null = not judged) */
  verdict: string | null;
  /** an admin decided that verdict by hand (the review: an admin's REJECT is final, the machine's is not) */
  overridden: boolean;
}

/** Which completed shifts a bulk re-judge takes: by their verdict ('unjudged' = none yet, 'all' = every one), completed since `since`, at most `limit`. */
export interface RejudgeFilter {
  verdict: 'unjudged' | 'verified' | 'flagged' | 'rejected' | 'all';
  since: Date | null;
  limit: number;
}

export interface LeaderboardRow {
  wallet: string;
  distance: number;
  /** total drive time of the counted shifts, seconds */
  seconds: number;
  /** hull left at the end of the furthest counted shift (the one with the greatest distance); null when that shift reported none */
  hull: number | null;
  rides: number;
}

export interface LeaderboardEntry extends LeaderboardRow {
  /** 1-based place in the requested sort. Not capped. */
  rank: number;
}

export interface LeaderboardPage {
  rows: LeaderboardEntry[];
  /** wallets with a counted shift, before the top-100 cap */
  total: number;
}

/** The read side: projections over rides that no aggregate needs. */
export abstract class RideQueryPort {
  /** Running rides whose last heartbeat is at or after `heartbeatSince`, newest first. */
  abstract live(heartbeatSince: Date, limit: number): Promise<LiveRideRow[]>;
  /** Running rides whose last heartbeat is OLDER than `cutoff` (their tab vanished) – oldest first; the sweeper ends them. */
  abstract staleRunning(cutoff: Date, limit: number): Promise<{ id: string; wallet: string }[]>;
  /** 1h rides still running whose start is older than the 90-minute cap. */
  abstract overCapRunning(startedBefore: Date, limit: number): Promise<{ id: string; wallet: string }[]>;
  /** Paid rides that are bought but not started yet (free rides never queue), most recently paid first. */
  abstract upcoming(limit: number): Promise<UpcomingRideRow[]>;
  /** The last rides that started and then ended, newest first. */
  abstract finished(limit: number): Promise<FinishedRideRow[]>;
  /** The replays history: rides that started and ended, newest end first (ties: newer first), filtered, paged by a cursor. */
  abstract history(filter: HistoryFilter): Promise<HistoryRideRow[]>;
  /** skipRejected: the badge facts leave out rides the verdict rejected (achievements.ts badgeRejected) – the caller passes VERDICT_ENFORCE; `stats` never do */
  abstract summary(wallet: string, opts?: { skipRejected?: boolean }): Promise<RideSummary>;
  abstract recent(wallet: string, limit: number): Promise<RecentRideRow[]>;
  /** Completed rides grouped by wallet. `sort` orders the page (`distance` is the prize order — domain/economy/leaderboard-order.ts, mirrored in SQL).
      `offset` / `limit` page that order; `cap` drops places past it (the lobby's top 100) but `total` still counts every wallet.
      `roundId` is required for the 'round' board. `tier` (1h / 4h / 8h) limits a paid board to that shift; null counts every paid shift. The free board ignores it.
      `verifiedOnly`: the PAID boards count only rides whose recording was verified (false = shadow mode);
      the free board always counts every completed free ride of the trip `trip` (a free LEVEL's, ride-trip.ts FREE_LEVELS; required for 'free', ignored by the paid boards). */
  abstract leaderboard(board: LeaderboardBoard, roundId: number | null, verifiedOnly: boolean, trip: string | null, tier: PaidTierId | null, sort: LeaderboardSort, offset: number, limit: number, cap: number): Promise<LeaderboardPage>;
  /** One wallet's place in that same order, or null when they have no counted shift. The rank is not capped. */
  abstract leaderboardPlace(board: LeaderboardBoard, roundId: number | null, verifiedOnly: boolean, trip: string | null, tier: PaidTierId | null, wallet: string, sort: LeaderboardSort): Promise<LeaderboardEntry | null>;
  /** The distance ranking over the completed rides paid with one pool's tickets – what that pool's prizes are paid by (`verifiedOnly` as for the paid boards). */
  abstract poolRanking(poolId: number, limit: number, verifiedOnly: boolean): Promise<LeaderboardRow[]>;
  /** The completed rides of one pool an ADMIN still has to decide on: no verdict yet, or a machine verdict that is not `verified` (flagged, rejected,
      pending) and no admin override. While any is left, the payout job pays nothing from the pool – every such ride gets a human look first. */
  abstract poolUnreviewed(poolId: number, limit: number): Promise<{ id: string; wallet: string; verdict: string | null }[]>;
  /** Completed shifts for the bulk re-judge, oldest end first, with the status of their verdict (null = never judged). */
  /** completed rides to judge again – never one of a pool whose payout plan exists (decided money) */
  abstract forRejudge(filter: RejudgeFilter): Promise<{ id: string; verdict: string | null }[]>;
}
