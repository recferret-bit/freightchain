import type { TicketBalanceDto, TicketGrantDto } from '../economy/prize-pool.dto.js';
import type { AchievementDto } from '../achievements/achievement-unlock.entity.js';

/** One truck on the road. No ride id, seed or free-text reason: this feed is public. */
export interface LiveRideDto {
  wallet: string;
  tier: string;
  route: string | null;
  timeScale: number;
  paused: boolean;
  hull: number | null;
  driveSeconds: number;
  minSeconds: number;
  distance: number;
  completeDist: number;
  progress: number;
  sinceBeat: number;
  startedAt: number;
}

/** A paid shift waiting for its driver to turn the key. Public, so: no ride id. */
export interface UpcomingRideDto {
  wallet: string;
  tier: string;
  minSeconds: number;
  paidAt: number;
}

/** A ride that just ended, for the landing's ticker: outcome + distance, never the id or the reason. */
export interface FinishedRideDto {
  wallet: string;
  tier: string;
  route: string | null;
  status: string;
  distance: number;
  endedAt: number | null;
}

export interface LiveTotalsDto {
  shifts: number;
  metres: number;
  drivers: number;
}

export interface LiveFeedDto {
  now: number;
  rides: LiveRideDto[];
  upcoming: UpcomingRideDto[];
  recent: FinishedRideDto[];
  totals: LiveTotalsDto;
}

export interface ProfileStatsDto {
  rides: number;
  completed: number;
  metres: number;
  bestMetres: number;
  paidRides: number;
  spentLamports: number;
}

export interface RecentRideDto {
  tier: string;
  status: string;
  distance: number;
  hull: number | null;
  route: string | null;
  timeScale: number;
  startedAt: number;
  endedAt: number | null;
}

export interface ProfileDto {
  wallet: string;
  createdAt: number;
  freeRides: number;
  freeRidesMax: number;
  nextFreeRideAt: number | null;
  demo: boolean;
  demoScale: number;
  stats: ProfileStatsDto;
  recent: RecentRideDto[];
  achievements: AchievementDto[];
  tickets: TicketBalanceDto[];
  /** the newest lines of the ticket audit trail */
  grants: TicketGrantDto[];
}

export const LIVE_FEED_LIMIT = 50;
export const UPCOMING_LIMIT = 20;
export const FINISHED_LIMIT = 12;
export const RECENT_RIDES_LIMIT = 10;
export const RECENT_GRANTS_LIMIT = 20;
