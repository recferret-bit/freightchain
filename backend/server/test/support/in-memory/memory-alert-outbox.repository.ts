import { AlertOutboxRepositoryPort } from '../../../src/application/ports/admin/alert-outbox.repository.port.js';
import type { AlertRecord } from '../../../src/domain/admin/privileged-records.js';

/** Process-local alert rows. The HTTP harness has no Prisma models. */
export class MemoryAlertOutboxRepository extends AlertOutboxRepositoryPort {
  private readonly rows = new Map<string, AlertRecord>();

  insert(row: AlertRecord): Promise<void> {
    this.rows.set(row.id, { ...row });
    return Promise.resolve();
  }

  due(now: Date, limit: number): Promise<AlertRecord[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => row.status === 'pending' && row.nextAttemptAt.getTime() <= now.getTime()).sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime()).slice(0, limit));
  }

  markSent(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, status: 'sent', sentAt: at });
    return Promise.resolve();
  }

  markRetry(id: string, attempts: number, nextAt: Date, error: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, attempts, nextAttemptAt: nextAt, lastError: error, status: attempts >= 48 ? 'undelivered' : 'pending' });
    return Promise.resolve();
  }

  active(limit: number): Promise<AlertRecord[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => row.status === 'pending' || row.status === 'undelivered').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit));
  }

  countUndelivered(): Promise<number> {
    return Promise.resolve([...this.rows.values()].filter((row) => row.status === 'undelivered').length);
  }
}
