import type { RideReview } from '../verdict/ride-review.js';
import type { StatsDto } from '../stats/stats.js';
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
  /** spectators on its watch page right now */
  viewers: number;
  /** 'live' = beating · 'paused' = the driver paused · 'weak' = no heartbeat for WEAK_SIGNAL_SECONDS (a tab in the background, a bad connection) */
  signal: 'live' | 'paused' | 'weak';
}

/** heartbeats come every ~10 s; this long without one the live feed calls the ride's signal weak (the ride leaves the feed at HB_TIMEOUT_MS) */
export const WEAK_SIGNAL_SECONDS = 40;

/** Who is on the site right now – SOFT numbers from the pages' own polls, kept in memory by one app process (a restart starts from zero). */
export interface OnlineDto {
  /** total = browsing + watching + driving */
  total: number;
  /** on the landing or the lobby (their /api/live poll, ≤ 3 per address) */
  browsing: number;
  /** on a watch page */
  watching: number;
  /** rides on the air */
  driving: number;
  /** signed-in wallets among them (browsing signed in, or driving) */
  players: number;
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

/** One ended ride of the replays history. Public: the fail CODE, never the free-text reason. */
export interface ReplayRideDto {
  id: string;
  wallet: string;
  tier: string;
  route: string | null;
  status: string;
  /** failed rides: heartbeat_lost · crash · off_road · hull · … (domain/rides/fail-code.ts); null otherwise */
  failCode: string | null;
  distance: number;
  driveSeconds: number;
  minSeconds: number;
  timeScale: number;
  startedAt: number;
  endedAt: number;
  /** its recording is still kept – it can be replayed on the watch page (TELEMETRY_RETENTION_DAYS) */
  replay: boolean;
}

export interface ReplaysDto {
  rows: ReplayRideDto[];
  /** pass as `before` for the next (older) page; null = the end */
  next: string | null;
}

export const REPLAYS_PAGE = 20;
export const REPLAYS_MAX_PAGE = 50;

/** The landing's "driven, all time" – read from the statistics table (docs/statistics.md): every started ride that ended counts, not only complete shifts. */
export interface LiveTotalsDto {
  /** complete shifts */
  shifts: number;
  /** started rides that ended, whatever the outcome */
  rides: number;
  ridesFree: number;
  ridesPaid: number;
  metres: number;
  seconds: number;
  drivers: number;
  crashes: number;
  donations: number;
}

export interface LiveFeedDto {
  now: number;
  rides: LiveRideDto[];
  upcoming: UpcomingRideDto[];
  recent: FinishedRideDto[];
  totals: LiveTotalsDto;
  online: OnlineDto;
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
  /** a PAID ride's review – accepted / under_review / rejected (domain/verdict/ride-review.ts); null for free rides and rides that did not complete */
  review: RideReview | null;
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
  /** this rider's running totals (the statistics table): rides, time, distance, crashes, donations on their streams */
  career: StatsDto;
  recent: RecentRideDto[];
  achievements: AchievementDto[];
  /** where the badge cNFTs live (explorer links); null while minting is not configured */
  badgeChain: { collection: string; tree: string } | null;
  tickets: TicketBalanceDto[];
  /** the newest lines of the ticket audit trail */
  grants: TicketGrantDto[];
  /** the same two boxes as /api/me, so the PROFILE tab and the NEW RIDE tab share one read */
  agreements: { age18: boolean; loss: boolean; age18At: number | null; lossAt: number | null };
}

export const LIVE_FEED_LIMIT = 50;
export const UPCOMING_LIMIT = 20;
export const FINISHED_LIMIT = 12;
export const RECENT_RIDES_LIMIT = 10;
export const RECENT_GRANTS_LIMIT = 20;
