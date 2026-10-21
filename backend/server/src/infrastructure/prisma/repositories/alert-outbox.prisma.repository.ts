import { Injectable } from '@nestjs/common';
import type { AlertRecord } from '../../../domain/admin/privileged-records.js';
import { AlertOutboxRepositoryPort } from '../../../application/ports/admin/alert-outbox.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const toRow = (r: { id: string; kind: string; text: string; money: boolean; status: string; attempts: number; nextAttemptAt: Date; lastError: string | null; createdAt: Date; sentAt: Date | null; requestId: string | null }): AlertRecord => r;

@Injectable()
export class AlertOutboxPrismaRepository extends AlertOutboxRepositoryPort {
  constructor(private readonly prisma: PrismaService) { super(); }

  async insert(row: AlertRecord, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).alertOutbox.create({ data: row });
  }

  async due(now: Date, limit: number): Promise<AlertRecord[]> {
    const rows = await this.prisma.alertOutbox.findMany({ where: { status: 'pending', nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: 'asc' }, take: limit });
    return rows.map(toRow);
  }

  async markSent(id: string, at: Date): Promise<void> {
    await this.prisma.alertOutbox.update({ where: { id }, data: { status: 'sent', sentAt: at } });
  }

  async markRetry(id: string, attempts: number, nextAt: Date, error: string): Promise<void> {
    const undelivered = attempts >= 48;
    await this.prisma.alertOutbox.update({ where: { id }, data: { attempts, nextAttemptAt: nextAt, lastError: error, status: undelivered ? 'undelivered' : 'pending' } });
  }

  async active(limit: number): Promise<AlertRecord[]> {
    const rows = await this.prisma.alertOutbox.findMany({ where: { status: { in: ['pending', 'undelivered'] } }, orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(toRow);
  }

  async countUndelivered(): Promise<number> {
    return this.prisma.alertOutbox.count({ where: { status: 'undelivered' } });
  }
}
