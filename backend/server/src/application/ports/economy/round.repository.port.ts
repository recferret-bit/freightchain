import type { Round } from '../../../domain/economy/round.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export interface RoundEntries {
  lamports: number;
  count: number;
}

export abstract class RoundRepositoryPort {
  abstract findContaining(at: Date, tx?: TransactionHandle): Promise<Round | null>;
  abstract findLatest(tx?: TransactionHandle): Promise<Round | null>;
  /** Persists a new round; null when a round for that week already exists (a concurrent first request won). Inside a transaction a null means it is aborted: roll back. */
  abstract insert(round: Round, tx?: TransactionHandle): Promise<Round | null>;
  abstract save(round: Round, tx?: TransactionHandle): Promise<void>;
  abstract entriesOf(roundId: number, tx?: TransactionHandle): Promise<RoundEntries>;
  /**
   * `SELECT … FOR UPDATE` on the round: holds it until the transaction ends and says whether it is still open. Paying INTO a round and closing it (computing
   * the next round's carry from its entries) both take this lock, so a payment can never land in a round after its carry was taken.
   */
  abstract lockOpen(roundId: number, tx: TransactionHandle): Promise<boolean>;
}
