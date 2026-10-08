import { Injectable } from '@nestjs/common';
import type { RideBatch } from '../../../domain/telemetry/ride-batch.entity.js';
import { RideBatchRepositoryPort } from '../../../application/ports/telemetry/ride-batch.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { RideBatchMapper } from '../mappers/ride-batch.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class RideBatchPrismaRepository extends RideBatchRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** ONE statement with ON CONFLICT DO NOTHING: two uploads of the same seq race safely, exactly one stores. */
  async insert(batch: RideBatch, tx?: TransactionHandle): Promise<boolean> {
    const { count } = await clientFor(this.prisma, tx).rideBatch.createMany({ data: [RideBatchMapper.toCreateData(batch)], skipDuplicates: true });
    return count === 1;
  }

  async deleteForRidesEndedBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.rideBatch.deleteMany({
      // kept: flagged rides (until reviewed) and completed shifts that were never judged (JUDGE NOW still needs their recording)
      where: { ride: { endedAt: { lt: cutoff }, OR: [{ verdict: { is: { status: { not: 'flagged' } } } }, { verdict: { is: null }, status: { not: 'completed' } }] } },
    });
    return count;
  }

  async listByRide(rideId: string, tx?: TransactionHandle): Promise<RideBatch[]> {
    const rows = await clientFor(this.prisma, tx).rideBatch.findMany({ where: { rideId }, orderBy: { seq: 'asc' } });
    return rows.map((row) => RideBatchMapper.toDomain(row));
  }

  async listFrom(rideId: string, fromSeq: number, limit: number): Promise<RideBatch[]> {
    const rows = await this.prisma.rideBatch.findMany({ where: { rideId, seq: { gte: fromSeq } }, orderBy: { seq: 'asc' }, take: limit });
    return rows.map((row) => RideBatchMapper.toDomain(row));
  }

  async extent(rideId: string): Promise<{ lastSeq: number | null; t1: number }> {
    const agg = await this.prisma.rideBatch.aggregate({ where: { rideId }, _max: { seq: true, t1: true } });
    return { lastSeq: agg._max.seq, t1: agg._max.t1 ?? 0 };
  }
}
