import { Injectable } from '@nestjs/common';
import type { RideAppeal } from '@prisma/client';
import { RideAppealRepositoryPort } from '../../../application/ports/rides/ride-appeal.repository.port.js';
import type { AppealStatus, RideAppealRecord } from '../../../domain/rides/ride-appeal.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const toRecord = (row: RideAppeal): RideAppealRecord => ({
  id: row.id, rideId: row.rideId, wallet: row.wallet, poolId: row.poolId, reason: row.reason, status: row.status as AppealStatus,
  createdAt: row.createdAt, resolvedAt: row.resolvedAt, resolvedBy: row.resolvedBy, resolution: row.resolution,
});

@Injectable()
export class RideAppealPrismaRepository extends RideAppealRepositoryPort {
  constructor(private readonly prisma: PrismaService) { super(); }

  async findByRide(rideId: string, tx?: TransactionHandle): Promise<RideAppealRecord | null> {
    const row = await clientFor(this.prisma, tx).rideAppeal.findUnique({ where: { rideId } });
    return row ? toRecord(row) : null;
  }

  async findById(id: string, tx?: TransactionHandle): Promise<RideAppealRecord | null> {
    const row = await clientFor(this.prisma, tx).rideAppeal.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async insert(row: RideAppealRecord, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).rideAppeal.create({ data: row });
  }

  async save(row: RideAppealRecord, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).rideAppeal.update({ where: { id: row.id }, data: row });
  }

  async listOpen(poolId?: number): Promise<RideAppealRecord[]> {
    const rows = await this.prisma.rideAppeal.findMany({ where: { status: 'open', ...(poolId !== undefined ? { poolId } : {}) }, orderBy: { createdAt: 'asc' } });
    return rows.map(toRecord);
  }

  async blockers(poolId: number): Promise<{ openAppeals: number; running: number }> {
    const [openAppeals, running] = await Promise.all([
      this.prisma.rideAppeal.count({ where: { poolId, status: 'open' } }),
      this.prisma.ride.count({ where: { poolId, status: 'running' } }),
    ]);
    return { openAppeals, running };
  }
}
