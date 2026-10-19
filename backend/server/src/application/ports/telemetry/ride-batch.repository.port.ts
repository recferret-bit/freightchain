import type { BatchFacts, RideBatch } from '../../../domain/telemetry/ride-batch.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class RideBatchRepositoryPort {
  /** Stores the batch; false when (rideId, seq) already exists (a re-send – nothing is overwritten). */
  abstract insert(batch: RideBatch, tx?: TransactionHandle): Promise<boolean>;
  /** Every batch of the ride, by seq ascending. */
  abstract listByRide(rideId: string, tx?: TransactionHandle): Promise<RideBatch[]>;
  /** What judging reads: the chain columns and the summary of every batch, by seq ascending – the payloads stay on disk (a row without a summary is summarised from its payload). */
  abstract listFactsByRide(rideId: string, tx?: TransactionHandle): Promise<BatchFacts[]>;
  /** Canonical bytes the ride holds so far (the per-ride byte budget). */
  abstract totalBytes(rideId: string, tx?: TransactionHandle): Promise<number>;
  /** A replay page: the batches with seq ≥ `fromSeq`, by seq ascending, at most `limit` (the watch page). */
  abstract listFrom(rideId: string, fromSeq: number, limit: number): Promise<RideBatch[]>;
  /** How far the recording goes: the last seq and the latest game time (null / 0 = nothing stored), without inflating any payload. */
  abstract extent(rideId: string): Promise<{ lastSeq: number | null; t1: number }>;
  /** Retention: deletes the batches of rides that ENDED before `cutoff`, except rides whose verdict is flagged (kept for review) and completed shifts
      that were never judged. Returns how many were deleted. */
  abstract deleteForRidesEndedBefore(cutoff: Date): Promise<number>;
}
