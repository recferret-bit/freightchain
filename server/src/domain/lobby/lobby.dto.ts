import type { TicketBalanceDto, TicketGrantDto } from '../economy/prize-pool.dto.js';
import type { AchievementDto } from '../achievements/achievement-unlock.entity.js';

/** One truck on the road. Public, so no seed or free-text reason. The ride id IS here (since live streams): it is what the watch page takes, and every
    owner-side route checks the wallet anyway – an id grants nothing (docs/solana-features-plan.md F5 publishes ride pages by id too). */
export interface LiveRideDto {
  id: string;
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

/** A ride that just ended, for the landing's ticker: outcome + distance + the id (its replay on the watch page), never the reason. */
export interface FinishedRideDto {
  id: string;
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
  /** legacy pay-per-ride payments + paid (not refunded) ticket orders */
  spentLamports: number;
  /** paid (not refunded) pool tickets */
  ticketsBought: number;
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
  /** verified / flagged / rejected / null (not judged – only completed shifts are) */
  verdict: string | null;
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
