import type { Facts } from '../../../domain/achievements/achievements.js';
import type { LeaderboardBoard } from '../../../domain/economy/economy.dto.js';

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
}

/** All-time numbers over completed rides. */
export interface RideTotalsRow {
  shifts: number;
  metres: number;
  drivers: number;
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
}

export interface LeaderboardRow {
  wallet: string;
  distance: number;
  rides: number;
}

/** The read side: projections over rides that no aggregate needs. */
export abstract class RideQueryPort {
  /** Running rides whose last heartbeat is at or after `heartbeatSince`, newest first. */
  abstract live(heartbeatSince: Date, limit: number): Promise<LiveRideRow[]>;
  /** Running rides whose last heartbeat is OLDER than `cutoff` (their tab vanished) – oldest first; the sweeper ends them. */
  abstract staleRunning(cutoff: Date, limit: number): Promise<{ id: string; wallet: string }[]>;
  /** Paid rides that are bought but not started yet (free rides never queue), most recently paid first. */
  abstract upcoming(limit: number): Promise<UpcomingRideRow[]>;
  /** The last rides that started and then ended, newest first. */
  abstract finished(limit: number): Promise<FinishedRideRow[]>;
  /** The replays history: rides that started and ended, newest end first (ties: newer first), filtered, paged by a cursor. */
  abstract history(filter: HistoryFilter): Promise<HistoryRideRow[]>;
  /** Completed rides: how many, how far, by how many different wallets. */
  abstract totals(): Promise<RideTotalsRow>;
  abstract summary(wallet: string): Promise<RideSummary>;
  abstract recent(wallet: string, limit: number): Promise<RecentRideRow[]>;
  /** Completed rides ranked by total distance (ties: more rides, earlier first finish, wallet). `roundId` is required for the 'round' board.
      `verifiedOnly`: the PAID boards ('round', 'all') count only rides whose recording was verified (false = shadow mode); the free board always counts every completed free ride. */
  abstract leaderboard(board: LeaderboardBoard, roundId: number | null, limit: number, verifiedOnly: boolean): Promise<LeaderboardRow[]>;
  /** The same ranking over the completed rides paid with one pool's tickets – what that pool's prizes are paid by (`verifiedOnly` as for the paid boards). */
  abstract poolRanking(poolId: number, limit: number, verifiedOnly: boolean): Promise<LeaderboardRow[]>;
}
