import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AdminActionRecord } from '../../../domain/admin/admin.dto.js';
import { alertForAudit } from '../../../domain/admin/admin-alert.js';
import { maskIpSubnet } from '../../../domain/shared/ip-mask.js';
import { AdminActionRepositoryPort } from '../../../application/ports/admin/admin-action.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor, type DbClient } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const json = (value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull => (value == null ? Prisma.DbNull : value as Prisma.InputJsonValue);

function prepared(record: AdminActionRecord): AdminActionRecord {
  const ip = typeof record.detail.ip === 'string' ? maskIpSubnet(record.detail.ip) : record.ipSubnet ?? null;
  const detail = typeof record.detail.ip === 'string' ? { ...record.detail, ip } : record.detail;
  const signature = (detail.signed as { signature?: unknown } | undefined)?.signature;
  const sigHash = record.sigHash ?? (typeof signature === 'string' ? createHash('sha256').update(signature).digest('hex') : null);
  return { ...record, detail, ipSubnet: record.ipSubnet ?? ip, sigHash, role: record.role ?? null, beforeState: record.beforeState ?? null, afterState: record.afterState ?? null };
}

@Injectable()
export class AdminActionPrismaRepository extends AdminActionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async insert(record: AdminActionRecord, tx?: TransactionHandle): Promise<void> {
    if (tx) return this.write(clientFor(this.prisma, tx), record);
    await this.prisma.$transaction((client) => this.write(client, record));
  }

  async recent(limit: number): Promise<AdminActionRecord[]> {
    const rows = await this.prisma.adminAction.findMany({ orderBy: [{ at: 'desc' }, { id: 'desc' }], take: limit });
    return rows.map((r) => ({
      wallet: r.wallet, action: r.action, target: r.target, detail: r.detail as Record<string, unknown>, requestId: r.requestId, at: r.at,
      role: r.role, beforeState: r.beforeState as Record<string, unknown> | null, afterState: r.afterState as Record<string, unknown> | null, ipSubnet: r.ipSubnet, sigHash: r.sigHash,
    }));
  }

  async latest(action: string, target: string): Promise<AdminActionRecord | null> {
    const row = await this.prisma.adminAction.findFirst({ where: { action, target }, orderBy: [{ at: 'desc' }, { id: 'desc' }] });
    if (!row) return null;
    return {
      wallet: row.wallet, action: row.action, target: row.target, detail: row.detail as Record<string, unknown>, requestId: row.requestId, at: row.at,
      role: row.role, beforeState: row.beforeState as Record<string, unknown> | null, afterState: row.afterState as Record<string, unknown> | null, ipSubnet: row.ipSubnet, sigHash: row.sigHash,
    };
  }

  /** The audit row and its alert share the caller's transaction (or one opened here). */
  private async write(client: DbClient, record: AdminActionRecord): Promise<void> {
    const row = prepared(record);
    await client.adminAction.create({
      data: {
        wallet: row.wallet, action: row.action, target: row.target, detail: row.detail as Prisma.InputJsonValue, requestId: row.requestId, at: row.at,
        role: row.role, beforeState: json(row.beforeState), afterState: json(row.afterState), ipSubnet: row.ipSubnet, sigHash: row.sigHash,
      },
    });
    const queued = [alertForAudit(row, randomUUID())];
    if (row.action === 'auth.fail') {
      const since = new Date(row.at.getTime() - 10 * 60 * 1000);
      const n = await client.adminAction.count({
        where: { action: 'auth.fail', at: { gte: since }, OR: [{ wallet: row.wallet }, ...(row.ipSubnet ? [{ ipSubnet: row.ipSubnet }] : [])] },
      });
      if (n >= 5) queued.push(alertForAudit({ ...row, action: 'auth.fail.burst', target: row.ipSubnet ?? row.wallet }, randomUUID()));
    }
    for (const alert of queued) {
      if (!alert) continue;
      await client.alertOutbox.create({ data: alert });
    }
  }
}
