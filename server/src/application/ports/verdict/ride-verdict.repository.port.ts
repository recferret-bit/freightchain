import type { RideVerdict } from '../../../domain/verdict/ride-verdict.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class RideVerdictRepositoryPort {
  /** Insert or replace the ride's verdict (a ride has one; judging again overwrites it). */
  abstract save(verdict: RideVerdict, tx?: TransactionHandle): Promise<void>;
  abstract findByRide(rideId: string, tx?: TransactionHandle): Promise<RideVerdict | null>;
}
