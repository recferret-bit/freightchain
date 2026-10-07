import type { RideTicket } from '../../../domain/players/ride-ticket.entity.js';
import type { TicketGrantProps } from '../../../domain/players/ride-ticket.types.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/**
 * A wallet's tickets per pool. Everything that changes ONE wallet's balance runs under its player row lock (`PlayerRepositoryPort.findByWalletForUpdate`) in one transaction;
 * `voidAllOfPool` runs under the pool lock instead and bumps every version it touches, so a concurrent save of the same row fails its version check instead of overwriting.
 */
export abstract class RideTicketRepositoryPort {
  /** The wallet's row for this pool, or null when it never had one. */
  abstract find(wallet: string, poolId: number, tx?: TransactionHandle): Promise<RideTicket | null>;
  /** All of the wallet's rows, by pool id. */
  abstract listByWallet(wallet: string, tx?: TransactionHandle): Promise<RideTicket[]>;
  /** Creates the row (balance 0) unless it exists – a concurrent first purchase is not an error – and returns the stored row. */
  abstract open(wallet: string, poolId: number, tx?: TransactionHandle): Promise<RideTicket>;
  /** Optimistic lock: throws VersionConflictError when the stored version is no longer the entity's. Returns the saved entity (version + 1). */
  abstract save(ticket: RideTicket, tx?: TransactionHandle): Promise<RideTicket>;
  /** Append one line to the audit trail. */
  abstract appendGrant(grant: TicketGrantProps, tx?: TransactionHandle): Promise<void>;
  /** The wallet's newest lines first. */
  abstract recentGrants(wallet: string, limit: number, tx?: TransactionHandle): Promise<TicketGrantProps[]>;
  /** A pool failed: every unused ticket of it becomes 0 (version + 1) and gets a `void` line. Returns how many tickets were voided. The caller holds the pool lock. */
  abstract voidAllOfPool(poolId: number, now: Date, tx: TransactionHandle): Promise<number>;
}
