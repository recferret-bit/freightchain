import type { TransactionHandle } from '../shared/transaction.port.js';

/** `player.GameSetting`: one integer per key. Reads and writes take the caller's transaction so an audit row and the new value commit together. */
export abstract class SettingsRepositoryPort {
  abstract all(tx?: TransactionHandle): Promise<readonly { key: string; value: number }[]>;
  abstract upsert(key: string, value: number, tx?: TransactionHandle): Promise<void>;
}
