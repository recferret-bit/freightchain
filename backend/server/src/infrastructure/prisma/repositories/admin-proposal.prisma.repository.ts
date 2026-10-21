import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AdminProposalRecord } from '../../../domain/admin/privileged-records.js';
import { AdminProposalRepositoryPort } from '../../../application/ports/admin/admin-proposal.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const toRow = (r: { id: string; action: string; target: string; proposerWallet: string; approverWallet: string | null; payload: Prisma.JsonValue; status: string; createdAt: Date; expiresAt: Date; appliedAt: Date | null; requestId: string | null }): AdminProposalRecord => ({
  ...r, payload: (r.payload ?? {}) as Record<string, unknown>,
});

@Injectable()
export class AdminProposalPrismaRepository extends AdminProposalRepositoryPort {
  constructor(private readonly prisma: PrismaService) { super(); }

  async insert(row: AdminProposalRecord, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).adminProposal.create({ data: { ...row, payload: row.payload as Prisma.InputJsonValue } });
  }

  async find(id: string): Promise<AdminProposalRecord | null> {
    const row = await this.prisma.adminProposal.findUnique({ where: { id } });
    return row ? toRow(row) : null;
  }

  async claim(id: string, approver: string, at: Date): Promise<boolean> {
    const updated = await this.prisma.adminProposal.updateMany({ where: { id, status: 'pending', expiresAt: { gt: at } }, data: { status: 'applying', approverWallet: approver } });
    return updated.count === 1;
  }

  async markApplied(id: string, at: Date): Promise<void> {
    await this.prisma.adminProposal.update({ where: { id }, data: { status: 'applied', appliedAt: at } });
  }

  async release(id: string): Promise<void> {
    await this.prisma.adminProposal.updateMany({ where: { id, status: 'applying' }, data: { status: 'pending', approverWallet: null } });
  }
}
