import type { AdminBatchDto, AdminRideFilter } from '../../../domain/admin/admin.dto.js';

export interface AdminCounts {
  players: number;
  running: number;
  rides: Record<string, number>;
  verdicts: Record<string, number>;
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
}

/** The admin page's read side: projections no aggregate needs (counts, filtered ride lists, a recording's batch index without the payloads). */
export abstract class AdminQueryPort {
  abstract counts(): Promise<AdminCounts>;
  /** completed shifts waiting for a human decision (verdict `flagged`) – the badge on the REVIEW QUEUE tab */
  abstract flaggedCount(): Promise<number>;
  /** newest first */
  abstract rides(filter: AdminRideFilter): Promise<AdminRideRow[]>;
  /** the ride's batches by seq – counts and hashes only, never the payload */
  abstract batchIndex(rideId: string): Promise<AdminBatchDto[]>;
}
