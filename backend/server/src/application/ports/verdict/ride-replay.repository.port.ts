import type { RideReplay } from '../../../domain/verdict/ride-replay.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class RideReplayRepositoryPort {
  abstract save(replay: RideReplay, tx?: TransactionHandle): Promise<RideReplay>;
  abstract findById(id: string, tx?: TransactionHandle): Promise<RideReplay | null>;
  abstract findLatestByRide(rideId: string, tx?: TransactionHandle): Promise<RideReplay | null>;
  abstract listByRide(rideId: string, tx?: TransactionHandle): Promise<RideReplay[]>;
  abstract listPending(limit: number): Promise<RideReplay[]>;
  abstract listRecent(filter: { status?: string; isPaid?: boolean; limit: number }): Promise<RideReplay[]>;
  abstract nextSeq(rideId: string, tx?: TransactionHandle): Promise<number>;
}
