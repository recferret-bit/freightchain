import type { AdminActionRecord } from '../../../domain/admin/admin.dto.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/** The admin audit log: append-only. */
export abstract class AdminActionRepositoryPort {
  abstract insert(record: AdminActionRecord, tx?: TransactionHandle): Promise<void>;
  /** newest first */
  abstract recent(limit: number): Promise<AdminActionRecord[]>;
  /** The newest audit row for this action and target, or null. */
  abstract latest(action: string, target: string): Promise<AdminActionRecord | null>;
}
