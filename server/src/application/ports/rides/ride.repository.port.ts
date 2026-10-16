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
  /** Finds the driver's best completed and verified ride in the given pool (longest distance, then fastest time). */
  abstract findBestVerifiedByPoolAndWallet(poolId: number, wallet: string, tx?: TransactionHandle): Promise<Ride | null>;
  /** The driver finished (completed) at least one ride of the pool, whatever its verdict. */
  abstract hasCompletedInPool(poolId: number, wallet: string, tx?: TransactionHandle): Promise<boolean>;
  /** Ranked starts in `[from, to)`, split free vs paid. The current start is not saved yet, so it is not in the count. */
  abstract countRankedStarts(wallet: string, from: Date, to: Date, tx?: TransactionHandle): Promise<{ free: number; paid: number }>;
  /** Ended ranked rides of one tier whose start fell in `[from, to)`. */
  abstract listRankedEnded(tier: string, from: Date, to: Date, tx?: TransactionHandle): Promise<Ride[]>;
}
