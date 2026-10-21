import type { DailyStatsDto, StatsDto } from '../stats/stats.js';
import type { LogEntry } from '../ops/log-entry.js';
import type { RideReplayDto } from '../verdict/ride-replay.entity.js';
import type { RideReview } from '../verdict/ride-review.js';
import type { VerdictDto } from '../verdict/verdict.dto.js';

/* The admin page's wire views (GET /api/admin/*). Admin-only, so they may carry ids, seeds and full wallets – the public feeds never do. */

/** One audited admin action. */
export interface AdminActionRecord {
  wallet: string;
  action: string;
  target: string;
  detail: Record<string, unknown>;
  requestId: string | null;
  at: Date;
  role?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  ipSubnet?: string | null;
  sigHash?: string | null;
}

export interface AdminOverviewDto {
  now: number;
  players: number;
  signIns24h: number;
  running: number;
  rides: Record<string, number>;
  verdicts: Record<string, number>;
  /** the review queue's length: completed PAID rides under review (flagged, machine-rejected, not judged) + flagged free rides */
  underReview: number;
  payments: { count: number; lamports: number };
  telemetry: { batches: number; bytes: number };
  config: { verdictEnforce: boolean; telemetryRetentionDays: number };
  /** Queued and undelivered operator alerts. The page paints these in the top banner. */
  activeAlerts: { id: string; kind: string; text: string; at: number }[];
  undeliveredAlerts: number;
}

/** the verdict filter of the rides list: a status, or 'none' = not judged */
export type AdminVerdictFilter = 'pending' | 'verified' | 'flagged' | 'rejected' | 'none';

export interface AdminRideFilter {
  wallet?: string;
  status?: string;
  verdict?: AdminVerdictFilter;
  /** 'under_review' = THE REVIEW QUEUE: every completed paid ride whose review is under_review (ride-review.ts – flagged, rejected by the machine,
      pending or not judged, no admin decision) FIRST, then the flagged free rides; each part newest first */
  review?: 'under_review';
  /** only the rides paid with this pool's tickets */
  poolId?: number;
  limit: number;
}

export interface AdminRideRowDto {
  id: string;
  wallet: string;
  tier: string;
  status: string;
  reason: string | null;
  route: string | null;
  distance: number;
  driveSeconds: number;
  timeScale: number;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  verdict: string | null;
  overridden: boolean;
  /** the prize pool whose ticket paid for it (null = free or a legacy order) */
  poolId: number | null;
  /** a paid ride's review (ride-review.ts); null for free rides and rides that did not complete */
  review: RideReview | null;
}

export interface AdminBatchDto {
  seq: number;
  t0: number;
  t1: number;
  samples: number;
  inputs: number;
  bytes: number;
  hashOk: boolean;
  receivedAt: number;
}

export interface AdminRideDetailDto {
  ride: AdminRideRowDto & { seed: number; minSeconds: number; completeDist: number; hull: number | null; lastHbAt: number | null; lamports: number; roundId: number | null };
  verdict: (VerdictDto & { scores: unknown; rulesVersion: number }) | null;
  replays?: RideReplayDto[];
  batches: AdminBatchDto[];
  payment: { signature: string; lamports: number; at: number } | null;
}

export interface AdminReplayFilter {
  status?: 'pending' | 'verified' | 'flagged' | 'rejected';
  isPaid?: boolean;
  limit: number;
}

export interface AdminReplaysDto {
  queue: { kind: 'redis' | 'memory'; depth: number };
  rows: RideReplayDto[];
}

export interface SignInRowDto {
  wallet: string;
  at: number;
  ip: string | null;
  userAgent: string | null;
}

export interface AdminActionDto {
  wallet: string;
  action: string;
  target: string;
  detail: Record<string, unknown>;
  requestId: string | null;
  at: number;
}

export interface AdminListDto<T> {
  rows: T[];
}

export interface AdminLogsDto {
  /** the in-memory ring of this process (lost on restart); the durable log is the container's: `npm run ops -- logs` */
  entries: LogEntry[];
}

export const ADMIN_LIST_MAX = 200;

/* ── the directory views: players, pools, statistics, sessions (read-only; the money stays on chain, repairs are `stats:reconcile`) ── */

export interface AdminPlayerRowDto {
  wallet: string;
  freeRides: number;
  freeRidesMax: number;
  createdAt: number;
  /** epoch ms of the newest sign-in on record (null = none kept – the log is pruned after SIGN_IN_RETENTION_DAYS) */
  lastSignInAt: number | null;
  /** started rides that ended */
  rides: number;
  /** unused tickets over every pool */
  tickets: number;
}

export interface AdminPlayerDetailDto {
  player: { wallet: string; freeRides: number; freeRidesMax: number; freeDay: string; createdAt: number; tutorialPassedAt: number | null; age18At: number | null; lossAt: number | null };
  stats: StatsDto | null;
  tickets: { poolId: number; balance: number; bought: number }[];
  grants: { poolId: number; delta: number; source: string; ref: string | null; at: number }[];
  payments: { count: number; lamports: number };
  signIns: SignInRowDto[];
  rides: AdminRideRowDto[];
}

export interface AdminPoolRowDto {
  id: number;
  address: string;
  tier: string;
  label: string;
  status: string;
  priceLamports: number;
  minTickets: number;
  maxTickets: number;
  maxPerWallet: number;
  ticketsSold: number;
  buyers: number;
  vaultLamports: number;
  sponsored: number;
  roundId: number | null;
  rideSeed: number;
  prepDeadline: number;
  playDeadline: number;
  createdAt: number;
  syncedAt: number | null;
}

export interface AdminPoolDetailDto {
  pool: AdminPoolRowDto & { prizeBps: number; seedBps: number; feeBps: number; feeTreasury: string; seedTreasury: string };
  holders: { wallet: string; balance: number; bought: number }[];
}

export interface AdminStatsDto {
  now: number;
  global: (StatsDto & { drivers: number; updatedAt: number }) | null;
  daily: DailyStatsDto[];
  top: { wallet: string; stats: StatsDto }[];
}

/** one wallet with a sign-in inside the window: a session cookie may still be alive (they last SESSION_TTL_DAYS and cannot be revoked one by one) */
export interface AdminSessionRowDto {
  wallet: string;
  lastAt: number;
  signIns: number;
  ip: string | null;
  userAgent: string | null;
}

export interface AdminSessionsDto {
  rows: AdminSessionRowDto[];
  /** more wallets signed in inside the window than one answer lists – the oldest are left out */
  truncated: boolean;
}
