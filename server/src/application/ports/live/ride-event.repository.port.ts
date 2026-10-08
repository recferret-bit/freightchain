import type { LiveTotalsByRide } from '../../../domain/live/live.dto.js';
import type { RideEvent } from '../../../domain/live/ride-event.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class RideEventRepositoryPort {
  /** Stores a new line and returns it numbered; null = refused: its bucket (rideId, slotKey, slot) is taken, or – `minGapMs` set (game effects) – the
      ride's last game effect is less than that old. The gap check and the insert run under a per-ride advisory lock, so racing posts never both pass. */
  abstract insert(event: RideEvent, minGapMs?: number): Promise<RideEvent | null>;
  /** when the ride's last game effect was posted (null = none) – for the 429's wait */
  abstract lastEffectAt(rideId: string): Promise<Date | null>;
  /** events of the ride whose applied stamp is newer than `since`, oldest stamp first */
  abstract listAppliedSince(rideId: string, since: Date, limit: number): Promise<RideEvent[]>;
  abstract findById(id: number, tx?: TransactionHandle): Promise<RideEvent | null>;
  /** the paid donation this transfer paid (null = none) */
  abstract findBySignature(signature: string): Promise<RideEvent | null>;
  /** The driver's game applied it: stores the stamp unless one is there already (first wins). True = this call stored it. */
  abstract saveApplied(event: RideEvent, tx?: TransactionHandle): Promise<boolean>;
  /** The ride's feed after event id `afterId`, oldest first, at most `limit`. */
  abstract listAfter(rideId: string, afterId: number, limit: number): Promise<RideEvent[]>;
  abstract totals(rideId: string): Promise<LiveTotalsByRide>;
}
