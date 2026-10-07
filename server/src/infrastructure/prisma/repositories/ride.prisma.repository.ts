import { Injectable } from '@nestjs/common';
import type { Ride } from '../../../domain/rides/ride.entity.js';
import { Ride as RideEntity } from '../../../domain/rides/ride.entity.js';
import { RideStatus } from '../../../domain/rides/ride-status.js';
import { VersionConflictError } from '../../../domain/shared/errors.js';
import { RideRepositoryPort } from '../../../application/ports/rides/ride.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { RideMapper } from '../mappers/ride.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const OPEN_PRIORITY: Partial<Record<RideStatus, number>> = { [RideStatus.Running]: 0, [RideStatus.Created]: 1, [RideStatus.AwaitingPayment]: 2 };
const NEWEST_FIRST = [{ createdAt: 'desc' as const }, { seq: 'desc' as const }]; // seq breaks ties between equal timestamps

@Injectable()
export class RidePrismaRepository extends RideRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findById(id: string, tx?: TransactionHandle): Promise<Ride | null> {
    const row = await clientFor(this.prisma, tx).ride.findUnique({ where: { id } });
    return row ? RideMapper.toDomain(row) : null;
  }

  async findOpenByWallet(wallet: string, tx?: TransactionHandle): Promise<Ride | null> {
    return (await this.listOpenByWallet(wallet, tx))[0] ?? null;
  }

  async listOpenByWallet(wallet: string, tx?: TransactionHandle): Promise<Ride[]> {
    const rows = await clientFor(this.prisma, tx).ride.findMany({ where: { wallet, status: { in: ['created', 'running', 'awaiting_payment'] } }, orderBy: NEWEST_FIRST });
    return rows.map((row) => RideMapper.toDomain(row)).sort((a, b) => (OPEN_PRIORITY[a.status] ?? 9) - (OPEN_PRIORITY[b.status] ?? 9)); // stable: newest first within a status
  }

  async findPendingPaid(wallet: string, since: Date, tx?: TransactionHandle): Promise<Ride | null> {
    const rows = await clientFor(this.prisma, tx).ride.findMany({
      where: { wallet, tier: { not: 'free' }, OR: [{ status: { in: ['awaiting_payment', 'created'] } }, { status: 'expired', createdAt: { gt: since } }] },
      orderBy: NEWEST_FIRST,
    });
    const rides = rows.map((row) => RideMapper.toDomain(row)).sort((a, b) => Number(b.status === RideStatus.Created) - Number(a.status === RideStatus.Created)); // a paid ride first
    return rides[0] ?? null;
  }

  async insert(ride: Ride, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).ride.create({ data: RideMapper.toCreateData(ride) });
  }

  async save(ride: Ride, tx?: TransactionHandle): Promise<Ride> {
    const p = ride.snapshot();
    const { count } = await clientFor(this.prisma, tx).ride.updateMany({
      where: { id: p.id, version: p.version },
      data: { ...RideMapper.mutableData(p), version: { increment: 1 } },
    });
    if (count !== 1) throw new VersionConflictError();
    return RideEntity.restore({ ...p, version: p.version + 1 });
  }
}
