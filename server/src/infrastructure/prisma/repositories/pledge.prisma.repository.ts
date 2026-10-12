import { Injectable } from '@nestjs/common';
import type { Pledge } from '../../../domain/economy/pledge.entity.js';
import { PledgeRepositoryPort } from '../../../application/ports/economy/pledge.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { PledgeMapper } from '../mappers/pledge.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class PledgePrismaRepository extends PledgeRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async insert(pledge: Pledge, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).pledge.create({
      data: PledgeMapper.toData(pledge),
    });
  }

  async save(pledge: Pledge, tx?: TransactionHandle): Promise<void> {
    const data = PledgeMapper.toData(pledge);
    await clientFor(this.prisma, tx).pledge.update({
      where: { id: pledge.id },
      data: {
        status: data.status,
        createSignature: data.createSignature,
        settled: data.settled,
        earnedLamports: data.earnedLamports,
        refundedLamports: data.refundedLamports,
        settledAt: data.settledAt,
        signature: data.signature,
        slot: data.slot,
      },
    });
  }

  async findById(id: string, tx?: TransactionHandle): Promise<Pledge | null> {
    const row = await clientFor(this.prisma, tx).pledge.findUnique({ where: { id } });
    return row ? PledgeMapper.toDomain(row) : null;
  }

  async findByPdaAddress(pdaAddress: string, tx?: TransactionHandle): Promise<Pledge | null> {
    const row = await clientFor(this.prisma, tx).pledge.findUnique({ where: { pdaAddress } });
    return row ? PledgeMapper.toDomain(row) : null;
  }

  async findByRideAndSponsor(rideId: string, sponsor: string, tx?: TransactionHandle): Promise<Pledge | null> {
    const row = await clientFor(this.prisma, tx).pledge.findUnique({
      where: { rideId_sponsor: { rideId, sponsor } },
    });
    return row ? PledgeMapper.toDomain(row) : null;
  }

  async findByRideId(rideId: string, tx?: TransactionHandle): Promise<Pledge[]> {
    const rows = await clientFor(this.prisma, tx).pledge.findMany({
      where: { rideId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(PledgeMapper.toDomain);
  }

  async findByDriver(driver: string, tx?: TransactionHandle): Promise<Pledge[]> {
    const rows = await clientFor(this.prisma, tx).pledge.findMany({
      where: { driver },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(PledgeMapper.toDomain);
  }

  async listOpen(tx?: TransactionHandle): Promise<Pledge[]> {
    const rows = await clientFor(this.prisma, tx).pledge.findMany({ where: { status: { in: ['pending', 'active'] } }, orderBy: { createdAt: 'asc' }, take: 500 });
    return rows.map(PledgeMapper.toDomain);
  }

  async listActiveByPool(poolId: number, tx?: TransactionHandle): Promise<Pledge[]> {
    const rows = await clientFor(this.prisma, tx).pledge.findMany({ where: { poolId, status: 'active' }, orderBy: { createdAt: 'asc' } });
    return rows.map(PledgeMapper.toDomain);
  }

  async findBySponsor(sponsor: string, tx?: TransactionHandle): Promise<Pledge[]> {
    const rows = await clientFor(this.prisma, tx).pledge.findMany({
      where: { sponsor },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(PledgeMapper.toDomain);
  }
}
