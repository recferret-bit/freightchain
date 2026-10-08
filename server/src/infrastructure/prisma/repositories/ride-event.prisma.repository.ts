import { Injectable } from '@nestjs/common';
import type { LiveTotalsByRide } from '../../../domain/live/live.dto.js';
import type { RideEvent } from '../../../domain/live/ride-event.entity.js';
import { RideEventRepositoryPort } from '../../../application/ports/live/ride-event.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { RideEventMapper } from '../mappers/ride-event.mapper.js';
import { clientFor, isUniqueViolation } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class RideEventPrismaRepository extends RideEventRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** A chat line / tip: ONE INSERT, the unique (rideId, slotKey, slot) key is its rate limit (a taken bucket is a unique violation → null).
      A game effect (`minGapMs`): one short transaction holding a per-ride ADVISORY lock (pg_advisory_xact_lock – no row is locked, so it cannot take part
      in the player → pool → ticket lock order) while it checks the ride's last effect and inserts: two racing effects serialise, the second sees the first. */
  async insert(event: RideEvent, minGapMs?: number): Promise<RideEvent | null> {
    const data = RideEventMapper.toCreateData(event);
    try {
      if (minGapMs === undefined) return RideEventMapper.toDomain(await this.prisma.rideEvent.create({ data }));
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`live-fx:${event.rideId}`}))`;
        const last = await tx.rideEvent.findFirst({ where: { rideId: event.rideId, slotKey: event.slotKey }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
        if (last && data.createdAt.getTime() - last.createdAt.getTime() < minGapMs) return null;
        return RideEventMapper.toDomain(await tx.rideEvent.create({ data }));
      }, { timeout: 10_000 });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async lastEffectAt(rideId: string): Promise<Date | null> {
    const last = await this.prisma.rideEvent.findFirst({ where: { rideId, slotKey: 'fx' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    return last?.createdAt ?? null;
  }

  async listAppliedSince(rideId: string, since: Date, limit: number): Promise<RideEvent[]> {
    const rows = await this.prisma.rideEvent.findMany({ where: { rideId, appliedAt: { gt: since } }, orderBy: { appliedAt: 'asc' }, take: limit });
    return rows.map((row) => RideEventMapper.toDomain(row));
  }

  async findById(id: number, tx?: TransactionHandle): Promise<RideEvent | null> {
    const row = await clientFor(this.prisma, tx).rideEvent.findUnique({ where: { id } });
    return row ? RideEventMapper.toDomain(row) : null;
  }

  /** Conditional UPDATE: only a row without a stamp takes one, so two acks race safely and the first wins. */
  async saveApplied(event: RideEvent, tx?: TransactionHandle): Promise<boolean> {
    const a = event.applied;
    if (event.id === null || !a) return false;
    const { count } = await clientFor(this.prisma, tx).rideEvent.updateMany({
      where: { id: event.id, appliedAt: null }, data: { appliedAt: a.at, appliedT: a.t, appliedS: a.s, appliedLat: a.lat },
    });
    return count === 1;
  }

  async listAfter(rideId: string, afterId: number, limit: number): Promise<RideEvent[]> {
    const rows = await this.prisma.rideEvent.findMany({ where: { rideId, id: { gt: afterId } }, orderBy: { id: 'asc' }, take: limit });
    return rows.map((row) => RideEventMapper.toDomain(row));
  }

  async totals(rideId: string): Promise<LiveTotalsByRide> {
    const groups = await this.prisma.rideEvent.groupBy({ by: ['kind'], where: { rideId }, _count: { _all: true }, _sum: { lamports: true } });
    const of = (kind: string) => groups.find((g) => g.kind === kind);
    return { messages: of('message')?._count._all ?? 0, donations: of('donation')?._count._all ?? 0, lamports: Number(of('donation')?._sum.lamports ?? 0n) };
  }
}
