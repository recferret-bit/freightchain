import type { AdminBatchDto, AdminRideFilter } from '../../../domain/admin/admin.dto.js';
import type { PoolRideFacts } from '../../../domain/verdict/pool-attention.js';

export interface AdminCounts {
  players: number;
  running: number;
  rides: Record<string, number>;
  verdicts: Record<string, number>;
  /** completed paid rides under review + flagged free rides (AdminRideFilter.review) */
  underReview: number;
  payments: { count: number; lamports: number };
  telemetry: { batches: number; bytes: number };
}

export interface AdminRideRow {
  id: string;
  wallet: string;
  tier: string;
  status: string;
  reason: string | null;
  route: string | null;
  lastS: number;
  driveSeconds: number;
  timeScale: number;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  verdict: string | null;
  overridden: boolean;
  poolId: number | null;
}

/** The admin page's read side: projections no aggregate needs (counts, filtered ride lists, a recording's batch index without the payloads). */
export abstract class AdminQueryPort {
  abstract counts(): Promise<AdminCounts>;
  /** completed shifts waiting for a human decision (verdict `flagged`) – the badge on the REVIEW QUEUE tab */
  abstract flaggedCount(): Promise<number>;
  /** the review queue's size, live: every PAID completed ride under review (flagged, machine-rejected, unjudged – no admin decision) + every flagged FREE ride */
  abstract queueCount(): Promise<number>;
  /** newest first; the review queue (`review: 'under_review'`): the paid rides under review first, then the flagged free ones */
  abstract rides(filter: AdminRideFilter): Promise<AdminRideRow[]>;
  /** every COMPLETED ride paid with the pool's tickets, with its verdict status and whether an admin decided it – the pool-level attention checks */
  abstract poolRides(poolId: number): Promise<PoolRideFacts[]>;
  /** the ride's batches by seq – counts and hashes only, never the payload */
  abstract batchIndex(rideId: string): Promise<AdminBatchDto[]>;
}
