import type { PlannedPayout, PoolPayoutRecord } from '../../../domain/economy/pool-payout.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/** The payout job's ledger (economy.PoolPayout): one row per prize, rank order. Every state change is a CONDITIONAL update – the return value says whether this caller won. */
export abstract class PoolPayoutRepositoryPort {
  abstract listByPool(poolId: number, tx?: TransactionHandle): Promise<PoolPayoutRecord[]>;
  /** Writes the plan once: rows whose (pool, rank) or (pool, wallet) already exist are left alone. */
  abstract plan(rows: PlannedPayout[], now: Date, tx?: TransactionHandle): Promise<void>;
  /** planned → sent with the signature (attempts + 1). false = another pass claimed it first – do NOT broadcast. */
  abstract claimSent(poolId: number, rank: number, signature: string, lastValidBlockHeight: number, now: Date, tx?: TransactionHandle): Promise<boolean>;
  /** sent (with this signature) → paid. */
  abstract markPaid(poolId: number, rank: number, signature: string, now: Date, tx?: TransactionHandle): Promise<boolean>;
  /** sent (with this signature) → planned again: the transaction expired without landing. */
  abstract release(poolId: number, rank: number, signature: string, error: string, now: Date, tx?: TransactionHandle): Promise<boolean>;
  /** planned → paid without a transaction of ours: the chain already shows a PrizePaid to this wallet (the admin paid it by hand). */
  abstract markPaidElsewhere(poolId: number, rank: number, now: Date, tx?: TransactionHandle): Promise<boolean>;
  /** The last error on a row (it stays in its status). */
  abstract noteError(poolId: number, rank: number, error: string, now: Date, tx?: TransactionHandle): Promise<void>;
}
