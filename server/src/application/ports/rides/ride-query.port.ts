import type { Facts } from '../../../domain/achievements/achievements.js';
import type { LeaderboardBoard } from '../../../domain/economy/economy.dto.js';

export interface LiveRideRow {
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
  abstract summary(wallet: string): Promise<RideSummary>;
  abstract recent(wallet: string, limit: number): Promise<RecentRideRow[]>;
  /** Completed rides ranked by total distance (ties: more rides, earlier first finish, wallet). `roundId` is required for the 'round' board. */
  abstract leaderboard(board: LeaderboardBoard, roundId: number | null, limit: number): Promise<LeaderboardRow[]>;
}
