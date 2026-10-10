import type { LogEntry } from '../ops/log-entry.js';
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
  batches: AdminBatchDto[];
  payment: { signature: string; lamports: number; at: number } | null;
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
