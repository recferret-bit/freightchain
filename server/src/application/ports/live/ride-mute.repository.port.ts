import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class RideMuteRepositoryPort {
  /** mute (true) or unmute (false) `wallet` on the ride – idempotent; true = something changed */
  abstract set(rideId: string, wallet: string, muted: boolean, now: Date, tx?: TransactionHandle): Promise<boolean>;
  abstract isMuted(rideId: string, wallet: string): Promise<boolean>;
  /** every muted wallet of the ride */
  abstract list(rideId: string): Promise<Set<string>>;
}
