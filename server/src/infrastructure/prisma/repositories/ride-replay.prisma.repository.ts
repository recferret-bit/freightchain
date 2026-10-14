import { Injectable } from '@nestjs/common';
import type { Prisma, VerdictStatus as VerdictStatusRow } from '@prisma/client';
import type { RideReplay } from '../../../domain/verdict/ride-replay.entity.js';
import { RideReplayRepositoryPort } from '../../../application/ports/verdict/ride-replay.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { RideReplayMapper } from '../mappers/ride-replay.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class RideReplayPrismaRepository extends RideReplayRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async save(replay: RideReplay, tx?: TransactionHandle): Promise<RideReplay> {
    const db = clientFor(this.prisma, tx);
    const data = RideReplayMapper.data(replay);
    const snap = replay.snapshot();
    const flagRows = snap.redFlags.map((f) => ({
      rideId: snap.rideId,
      code: f.code,
      category: f.category,
      severity: f.severity,
      detail: f.detail,
      atSecond: f.atSecond,
      atMetre: f.atMetre,
      evidence: (f.evidence ?? undefined) as Prisma.InputJsonValue | undefined,
      createdAt: snap.completedAt ?? snap.queuedAt,
    }));

    const row = await db.rideReplay.upsert({
      where: { id: replay.id },
      create: {
        id: replay.id,
        ...data,
        flags: flagRows.length ? { create: flagRows } : undefined,
      },
      update: {
        ...data,
        flags: {
          deleteMany: {},
          ...(flagRows.length ? { create: flagRows } : {}),
        },
      },
      include: { flags: { orderBy: { id: 'asc' } } },
    });
    return RideReplayMapper.toDomain(row);
  }

  async findById(id: string, tx?: TransactionHandle): Promise<RideReplay | null> {
    const row = await clientFor(this.prisma, tx).rideReplay.findUnique({
      where: { id },
      include: { flags: { orderBy: { id: 'asc' } } },
    });
    return row ? RideReplayMapper.toDomain(row) : null;
  }

  async findLatestByRide(rideId: string, tx?: TransactionHandle): Promise<RideReplay | null> {
    const row = await clientFor(this.prisma, tx).rideReplay.findFirst({
      where: { rideId },
      orderBy: [{ seq: 'desc' }],
      include: { flags: { orderBy: { id: 'asc' } } },
    });
    return row ? RideReplayMapper.toDomain(row) : null;
  }

  async listByRide(rideId: string, tx?: TransactionHandle): Promise<RideReplay[]> {
    const rows = await clientFor(this.prisma, tx).rideReplay.findMany({
      where: { rideId },
      orderBy: [{ seq: 'desc' }],
      include: { flags: { orderBy: { id: 'asc' } } },
    });
    return rows.map((r) => RideReplayMapper.toDomain(r));
  }

  async listPending(limit: number): Promise<RideReplay[]> {
    const rows = await this.prisma.rideReplay.findMany({
      where: { status: 'pending' },
      orderBy: [{ isPaid: 'desc' }, { queuedAt: 'asc' }],
      take: limit,
      include: { flags: { orderBy: { id: 'asc' } } },
    });
    return rows.map((r) => RideReplayMapper.toDomain(r));
  }

  async listRecent(filter: { status?: string; isPaid?: boolean; limit: number }): Promise<RideReplay[]> {
    const rows = await this.prisma.rideReplay.findMany({
      where: {
        ...(filter.status ? { status: filter.status as VerdictStatusRow } : {}),
        ...(filter.isPaid !== undefined ? { isPaid: filter.isPaid } : {}),
      },
      orderBy: [{ queuedAt: 'desc' }, { seq: 'desc' }],
      take: filter.limit,
      include: { flags: { orderBy: { id: 'asc' } } },
    });
    return rows.map((r) => RideReplayMapper.toDomain(r));
  }

  async nextSeq(rideId: string, tx?: TransactionHandle): Promise<number> {
    const agg = await clientFor(this.prisma, tx).rideReplay.aggregate({
      where: { rideId },
      _max: { seq: true },
    });
    return (agg._max.seq ?? 0) + 1;
  }
}
