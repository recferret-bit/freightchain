import type { RideAppealRecord } from '../../../domain/rides/ride-appeal.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export type { AppealStatus, RideAppealRecord } from '../../../domain/rides/ride-appeal.js';

export abstract class RideAppealRepositoryPort {
  abstract findByRide(rideId: string, tx?: TransactionHandle): Promise<RideAppealRecord | null>;
  abstract findById(id: string, tx?: TransactionHandle): Promise<RideAppealRecord | null>;
  abstract insert(row: RideAppealRecord, tx?: TransactionHandle): Promise<void>;
  abstract save(row: RideAppealRecord, tx?: TransactionHandle): Promise<void>;
  abstract listOpen(poolId?: number): Promise<RideAppealRecord[]>;
  /** open appeals and rides still `running` in the pool. */
  abstract blockers(poolId: number): Promise<{ openAppeals: number; running: number }>;
}
