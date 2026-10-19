import { Injectable } from '@nestjs/common';
import type { RideVerdict } from '../../../domain/verdict/ride-verdict.entity.js';
import { RideVerdictRepositoryPort } from '../../../application/ports/verdict/ride-verdict.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { RideVerdictMapper } from '../mappers/ride-verdict.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class RideVerdictPrismaRepository extends RideVerdictRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async save(verdict: RideVerdict, tx?: TransactionHandle): Promise<void> {
    const data = RideVerdictMapper.data(verdict);
    await clientFor(this.prisma, tx).rideVerdict.upsert({ where: { rideId: verdict.rideId }, create: { rideId: verdict.rideId, ...data }, update: { ...data, version: { increment: 1 } } });
  }

  async findByRide(rideId: string, tx?: TransactionHandle): Promise<RideVerdict | null> {
    const row = await clientFor(this.prisma, tx).rideVerdict.findUnique({ where: { rideId } });
    return row ? RideVerdictMapper.toDomain(row) : null;
  }
}
