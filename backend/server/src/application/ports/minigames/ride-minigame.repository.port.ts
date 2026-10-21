import type { RideMiniGame } from '../../../domain/minigames/ride-minigame.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class RideMiniGameRepositoryPort {
  abstract listByRide(rideId: string, tx?: TransactionHandle): Promise<RideMiniGame[]>;
  abstract findById(id: string, tx?: TransactionHandle): Promise<RideMiniGame | null>;
  /** Insert. A row that already exists for (rideId, ordinal) is returned unchanged — a racing heartbeat must not clobber a reveal. */
  abstract insert(row: RideMiniGame, tx?: TransactionHandle): Promise<RideMiniGame>;
  abstract save(row: RideMiniGame, tx?: TransactionHandle): Promise<void>;
}
