import type { AlertRecord } from '../../../domain/admin/privileged-records.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class AlertOutboxRepositoryPort {
  abstract insert(row: AlertRecord, tx?: TransactionHandle): Promise<void>;
  abstract due(now: Date, limit: number): Promise<AlertRecord[]>;
  abstract markSent(id: string, at: Date): Promise<void>;
  abstract markRetry(id: string, attempts: number, nextAt: Date, error: string): Promise<void>;
  abstract active(limit: number): Promise<AlertRecord[]>;
  abstract countUndelivered(): Promise<number>;
}
