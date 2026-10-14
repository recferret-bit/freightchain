import type { PlannedPayout, PoolPayoutRecord } from '../../../domain/economy/pool-payout.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/** The payout job's ledger (economy.PoolPayout): one row per prize, rank order. Every state change is a CONDITIONAL update – the return value says whether this caller won. */
export abstract class PoolPayoutRepositoryPort {
  abstract listByPool(poolId: number, tx?: TransactionHandle): Promise<PoolPayoutRecord[]>;
  /** Writes the plan once: rows whose (pool, rank) or (pool, wallet) already exist are left alone. */
  abstract plan(rows: PlannedPayout[], now: Date, tx?: TransactionHandle): Promise<void>;
  /** planned → sent with the signature (attempts + 1). false = another pass claimed it first – do NOT broadcast. */
  abstract claimSent(poolId: number, rank: number, signature: string, lastValidBlockHeight: number, now: Date, tx?: TransactionHandle): Promise<boolean>;
  /** claimSent, in ONE statement, only while the pool is not on an admin's HOLD (pentest L11): 'held' = the HOLD came first, nothing was claimed; 'lost' = another pass has it */
  abstract claimSentUnlessHeld(poolId: number, rank: number, signature: string, lastValidBlockHeight: number, now: Date): Promise<'claimed' | 'held' | 'lost'>;
  /** sent (with this signature) → paid. */
  abstract markPaid(poolId: number, rank: number, signature: string, now: Date, tx?: TransactionHandle): Promise<boolean>;
  /** sent (with this signature) → planned again: the transaction expired without landing. */
  abstract release(poolId: number, rank: number, signature: string, error: string, now: Date, tx?: TransactionHandle): Promise<boolean>;
  /** planned → paid without a transaction of ours: the chain already shows a PrizePaid to this wallet (the admin paid it by hand). */
  abstract markPaidElsewhere(poolId: number, rank: number, now: Date, tx?: TransactionHandle): Promise<boolean>;
  /** Drops the pool's plan, only while EVERY row is still planned (none sent or paid) – in one statement: false = something was sent or paid, nothing dropped.
      Program v4: the one case the job plans again is a winners root the admin vetoed (or one that never landed). */
  abstract discardPlan(poolId: number, tx?: TransactionHandle): Promise<boolean>;
  /** The last error on a row (it stays in its status). */
  abstract noteError(poolId: number, rank: number, error: string, now: Date, tx?: TransactionHandle): Promise<void>;
}
