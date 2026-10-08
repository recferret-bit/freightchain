import type { LiveTotalsByRide } from '../../../domain/live/live.dto.js';
import type { RideEvent } from '../../../domain/live/ride-event.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class RideEventRepositoryPort {
  /** Stores a new line and returns it numbered; null = its rate-limit window (rideId, slotKey, slot) is already taken – ONE statement, so racing posts are safe. */
  abstract insert(event: RideEvent): Promise<RideEvent | null>;
  abstract findById(id: number, tx?: TransactionHandle): Promise<RideEvent | null>;
  /** The driver's game applied it: stores the stamp unless one is there already (first wins). True = this call stored it. */
  abstract saveApplied(event: RideEvent, tx?: TransactionHandle): Promise<boolean>;
  /** The ride's feed after event id `afterId`, oldest first, at most `limit`. */
  abstract listAfter(rideId: string, afterId: number, limit: number): Promise<RideEvent[]>;
  abstract totals(rideId: string): Promise<LiveTotalsByRide>;
}
