import type { Ride } from '../../../domain/rides/ride.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class RideRepositoryPort {
  abstract findById(id: string, tx?: TransactionHandle): Promise<Ride | null>;
  /** The wallet's ride in hand (created / running / awaiting payment): a running one first, then a ready (maybe PAID) one, then an unpaid order. */
  abstract findOpenByWallet(wallet: string, tx?: TransactionHandle): Promise<Ride | null>;
  /** Every ride the wallet has in hand, in the same order as findOpenByWallet. */
  abstract listOpenByWallet(wallet: string, tx?: TransactionHandle): Promise<Ride[]>;
  /** A paid order the wallet may still be owed: paid-and-unstarted first, then unpaid / lapsed orders created since `since`. */
  abstract findPendingPaid(wallet: string, since: Date, tx?: TransactionHandle): Promise<Ride | null>;
  abstract insert(ride: Ride, tx?: TransactionHandle): Promise<void>;
  /** Optimistic lock on the ride's version (heartbeat vs end). Returns the saved entity (version + 1). */
  abstract save(ride: Ride, tx?: TransactionHandle): Promise<Ride>;
}
