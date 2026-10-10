import { Injectable } from '@nestjs/common';
import type { Prisma, RideStatus as RideStatusRow, VerdictStatus as VerdictStatusRow } from '@prisma/client';
import type { AdminBatchDto, AdminRideFilter } from '../../../domain/admin/admin.dto.js';
import { AdminQueryPort, type AdminCounts, type AdminRideRow } from '../../../application/ports/admin/admin-query.port.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class AdminQueryPrismaRepository extends AdminQueryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async counts(): Promise<AdminCounts> {
    const [players, rides, verdicts, payments, batches] = await Promise.all([
      this.prisma.player.count(),
      this.prisma.ride.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.rideVerdict.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.payment.aggregate({ _count: { _all: true }, _sum: { lamports: true } }),
      this.prisma.rideBatch.aggregate({ _count: { _all: true }, _sum: { bytes: true } }),
    ]);
    const byStatus = Object.fromEntries(rides.map((r) => [r.status, r._count._all]));
    return {
      players, running: byStatus['running'] ?? 0, rides: byStatus, verdicts: Object.fromEntries(verdicts.map((v) => [v.status, v._count._all])),
      payments: { count: payments._count._all, lamports: Number(payments._sum.lamports ?? 0n) },
      telemetry: { batches: batches._count._all, bytes: batches._sum.bytes ?? 0 },
    };
  }

  flaggedCount(): Promise<number> {
    return this.prisma.rideVerdict.count({ where: { status: 'flagged' } });   // index (status, judgedAt)
  }

  async rides(filter: AdminRideFilter): Promise<AdminRideRow[]> {
    const where: Prisma.RideWhereInput = {
      ...(filter.wallet ? { wallet: filter.wallet } : {}),
      ...(filter.status ? { status: filter.status as RideStatusRow } : {}),
      ...(filter.verdict === 'none' ? { verdict: { is: null } } : filter.verdict ? { verdict: { is: { status: filter.verdict as VerdictStatusRow } } } : {}),
    };
    const rows = await this.prisma.ride.findMany({ where, orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }], take: filter.limit, include: { verdict: { select: { status: true, overriddenBy: true } } } });
    return rows.map((r) => ({
      id: r.id, wallet: r.wallet, tier: r.tier, status: r.status, reason: r.reason, route: r.route, lastS: r.lastS, driveSeconds: r.driveSeconds, timeScale: r.timeScale,
      createdAt: r.createdAt, startedAt: r.startedAt, endedAt: r.endedAt, verdict: r.verdict?.status ?? null, overridden: (r.verdict?.overriddenBy ?? null) !== null,
    }));
  }

  async batchIndex(rideId: string): Promise<AdminBatchDto[]> {
    const rows = await this.prisma.rideBatch.findMany({
      where: { rideId }, orderBy: { seq: 'asc' }, select: { seq: true, t0: true, t1: true, samples: true, inputs: true, bytes: true, hashOk: true, receivedAt: true },
    });
    return rows.map((b) => ({ ...b, receivedAt: b.receivedAt.getTime() }));
  }
}
