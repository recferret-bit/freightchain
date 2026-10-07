import type { Pool } from '../../../domain/economy/pool.entity.js';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/**
 * The mirror of the on-chain pool accounts. There is no version column: the chain is the truth and the watcher / PoolSyncService overwrite the row.
 * LOCK ORDER (for anything that takes more than one): the player row (`findByWalletForUpdate`) → the pool row (`findByIdForUpdate`) → ticket rows. Never the other way round.
 */
export abstract class PoolRepositoryPort {
  abstract findById(id: number, tx?: TransactionHandle): Promise<Pool | null>;
  /** By its PDA (unique). */
  abstract findByAddress(address: string, tx?: TransactionHandle): Promise<Pool | null>;
  /** `SELECT … FOR UPDATE`: a status change (activate / fail / settle) and the voiding of tickets must not interleave with a settlement into the same pool. */
  abstract findByIdForUpdate(id: number, tx: TransactionHandle): Promise<Pool | null>;
  /** Pools by id (missing ids are left out), by id. */
  abstract findMany(ids: number[], tx?: TransactionHandle): Promise<Pool[]>;
  /** Every pool that is still selling or running (open | active), soonest play deadline first, then by id. */
  abstract listLive(tx?: TransactionHandle): Promise<Pool[]>;
  /** The live pools of one tier, in the same order – a ticket is ridden from the first active one the wallet holds tickets in. */
  abstract listLiveOfTier(tier: PaidTierId, tx?: TransactionHandle): Promise<Pool[]>;
  /** open pools whose `prepDeadline` has passed – the crank's work list. */
  abstract listOpenPastDeadline(now: Date, tx?: TransactionHandle): Promise<Pool[]>;
  /** Insert or overwrite by id (registering a pool, a sync, an applied event). */
  abstract upsert(pool: Pool, tx?: TransactionHandle): Promise<void>;
}
