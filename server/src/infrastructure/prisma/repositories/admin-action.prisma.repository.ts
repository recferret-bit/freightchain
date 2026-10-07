import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AdminActionRecord } from '../../../domain/admin/admin.dto.js';
import { AdminActionRepositoryPort } from '../../../application/ports/admin/admin-action.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class AdminActionPrismaRepository extends AdminActionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async insert(record: AdminActionRecord, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).adminAction.create({
      data: { wallet: record.wallet, action: record.action, target: record.target, detail: record.detail as Prisma.InputJsonValue, requestId: record.requestId, at: record.at },
    });
  }

  async recent(limit: number): Promise<AdminActionRecord[]> {
    const rows = await this.prisma.adminAction.findMany({ orderBy: [{ at: 'desc' }, { id: 'desc' }], take: limit });
    return rows.map((r) => ({ wallet: r.wallet, action: r.action, target: r.target, detail: r.detail as Record<string, unknown>, requestId: r.requestId, at: r.at }));
  }
}
