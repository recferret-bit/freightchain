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

export interface LiveFeedDto {
  now: number;
  rides: LiveRideDto[];
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
  demo: boolean;
  demoScale: number;
  stats: ProfileStatsDto;
  recent: RecentRideDto[];
  achievements: AchievementDto[];
}

export const LIVE_FEED_LIMIT = 50;
export const RECENT_RIDES_LIMIT = 10;
