import type { RideBatch } from '../../../domain/telemetry/ride-batch.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class RideBatchRepositoryPort {
  /** Stores the batch; false when (rideId, seq) already exists (a re-send – nothing is overwritten). */
  abstract insert(batch: RideBatch, tx?: TransactionHandle): Promise<boolean>;
  /** Every batch of the ride, by seq ascending. */
  abstract listByRide(rideId: string, tx?: TransactionHandle): Promise<RideBatch[]>;
  /** Retention: deletes the batches of rides that ENDED before `cutoff`, except rides whose verdict is flagged (kept for review) and completed shifts
      that were never judged. Returns how many were deleted. */
  abstract deleteForRidesEndedBefore(cutoff: Date): Promise<number>;
}
