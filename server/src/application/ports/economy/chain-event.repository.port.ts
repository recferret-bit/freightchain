import type { ChainEventRow } from '../../../domain/economy/chain-events.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/** The log of every program event the server saw – (signature, index) is unique, so handling an event twice is harmless. */
export abstract class ChainEventRepositoryPort {
  abstract find(signature: string, index: number, tx?: TransactionHandle): Promise<ChainEventRow | null>;
  /** false when the (signature, index) is already recorded (the caller treats it as a duplicate). Never throws on a duplicate, so it is safe inside a transaction. */
  abstract record(row: ChainEventRow, tx?: TransactionHandle): Promise<boolean>;
  /** The pool's newest events first (GET /api/pools/:id `recent`). */
  abstract recentOfPool(poolId: number, limit: number, tx?: TransactionHandle): Promise<ChainEventRow[]>;
  /** settled / applied events not yet stamped final – the finality pass's work list, oldest first. */
  abstract listUnfinalized(limit: number, tx?: TransactionHandle): Promise<ChainEventRow[]>;
  /** Stamps every not-yet-final event of the transaction. */
  abstract markFinalized(signature: string, at: Date, tx?: TransactionHandle): Promise<void>;
  /** The network dropped the transaction: its events become `dropped` (with the reason). */
  abstract markDropped(signature: string, detail: string, tx?: TransactionHandle): Promise<void>;
}

/** Where the program-log watcher stopped (key 'program'): the newest signature it has fully handled. */
export interface ChainCursorRow {
  key: string;
  signature: string | null;
  slot: number | null;
  at: Date;
}

export abstract class ChainCursorRepositoryPort {
  abstract get(key: string, tx?: TransactionHandle): Promise<ChainCursorRow | null>;
  /** insert or move the cursor */
  abstract set(row: ChainCursorRow, tx?: TransactionHandle): Promise<void>;
}
