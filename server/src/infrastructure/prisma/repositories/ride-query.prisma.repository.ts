import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { LeaderboardBoard } from '../../../domain/economy/economy.dto.js';
import {
  RideQueryPort, type FinishedRideRow, type LeaderboardRow, type LiveRideRow, type RecentRideRow, type RideSummary, type RideTotalsRow, type UpcomingRideRow,
} from '../../../application/ports/rides/ride-query.port.js';
import { PrismaService } from '../prisma.service.js';

const CLEAN_HULL = 99.5;
const NIGHT_SHARE = 0.5;
const SIBERIA = 'siberia';

/** The read side over rides: projections that no aggregate needs. */
const VERIFIED: Prisma.RideWhereInput = { verdict: { is: { status: 'verified' } } };

@Injectable()
export class RideQueryPrismaRepository extends RideQueryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async live(heartbeatSince: Date, limit: number): Promise<LiveRideRow[]> {
    const rows = await this.prisma.ride.findMany({
      where: { status: 'running', lastHbAt: { gte: heartbeatSince } },
      orderBy: [{ startedAt: 'desc' }, { seq: 'desc' }],
      take: limit,
    });
    return rows.flatMap((r) => (r.startedAt && r.lastHbAt
      ? [{ wallet: r.wallet, tier: r.tier, route: r.route, minSeconds: r.minSeconds, completeDist: r.completeDist, driveSeconds: r.driveSeconds, lastS: r.lastS, hull: r.hull,
        paused: r.paused, timeScale: r.timeScale, startedAt: r.startedAt, lastHbAt: r.lastHbAt }]
      : []));
  }

  async upcoming(limit: number): Promise<UpcomingRideRow[]> {
    const rows = await this.prisma.ride.findMany({
      where: { status: 'created', tier: { not: 'free' }, paidAt: { not: null } },
      orderBy: [{ paidAt: 'desc' }, { seq: 'desc' }],
      take: limit,
    });
    return rows.flatMap((r) => (r.paidAt ? [{ wallet: r.wallet, tier: r.tier, minSeconds: r.minSeconds, paidAt: r.paidAt }] : []));
  }

  async finished(limit: number): Promise<FinishedRideRow[]> {
    const rows = await this.prisma.ride.findMany({
      where: { status: { in: ['completed', 'abandoned', 'failed'] }, startedAt: { not: null } },
      orderBy: [{ endedAt: { sort: 'desc', nulls: 'last' } }, { seq: 'desc' }],
      take: limit,
    });
    return rows.map((r) => ({ wallet: r.wallet, tier: r.tier, route: r.route, status: r.status, lastS: r.lastS, endedAt: r.endedAt }));
  }

  async totals(): Promise<RideTotalsRow> {
    const where: Prisma.RideWhereInput = { status: 'completed' };
    const [sum, wallets] = await Promise.all([this.prisma.ride.aggregate({ where, _count: { _all: true }, _sum: { lastS: true } }), this.prisma.ride.groupBy({ by: ['wallet'], where })]);
    return { shifts: sum._count._all, metres: sum._sum.lastS ?? 0, drivers: wallets.length };
  }

  /** Two queries: one aggregate over the started rides, and the completed rides themselves (few per wallet) for the per-ride achievement facts. */
  async summary(wallet: string): Promise<RideSummary> {
    const [started, done] = await Promise.all([
      this.prisma.ride.aggregate({ where: { wallet, startedAt: { not: null } }, _count: { _all: true }, _sum: { lastS: true } }),
      this.prisma.ride.findMany({ where: { wallet, status: 'completed' }, select: { lastS: true, hull: true, route: true, nightSeconds: true, driveSeconds: true } }),
    ]);
    const metres = started._sum.lastS ?? 0;
    return {
      stats: { started: started._count._all, completed: done.length, metres, best: done.reduce((max, r) => Math.max(max, r.lastS), 0) },
      facts: {
        started: started._count._all, completed: done.length, totalMetres: metres,
        completedAtNight: done.some((r) => r.driveSeconds > 0 && r.nightSeconds >= NIGHT_SHARE * r.driveSeconds), // most of the shift in the dark: pressing N just before the end doesn't count
        cleanRun: done.some((r) => r.hull !== null && r.hull >= CLEAN_HULL),
        completedSiberia: done.some((r) => r.route === SIBERIA),
      },
    };
  }

  async recent(wallet: string, limit: number): Promise<RecentRideRow[]> {
    const rows = await this.prisma.ride.findMany({ where: { wallet, startedAt: { not: null } }, orderBy: [{ startedAt: 'desc' }, { seq: 'desc' }], take: limit, include: { verdict: { select: { status: true } } } });
    return rows.flatMap((r) => (r.startedAt
      ? [{ tier: r.tier, status: r.status, lastS: r.lastS, hull: r.hull, route: r.route, timeScale: r.timeScale, startedAt: r.startedAt, endedAt: r.endedAt, verdict: r.verdict?.status ?? null }]
      : []));
  }

  async leaderboard(board: LeaderboardBoard, roundId: number | null, limit: number, verifiedOnly: boolean): Promise<LeaderboardRow[]> {
    const tierFilter: Prisma.RideWhereInput = board === 'free' ? { tier: 'free' } : { tier: { not: 'free' }, ...(verifiedOnly ? VERIFIED : {}), ...(board === 'round' ? { roundId } : {}) }; // paid boards: verified recordings only (unless shadow mode)
    return this.ranked(tierFilter, limit);
  }

  async poolRanking(poolId: number, limit: number, verifiedOnly: boolean): Promise<LeaderboardRow[]> {
    return this.ranked({ poolId, ...(verifiedOnly ? VERIFIED : {}) }, limit);
  }

  private async ranked(filter: Prisma.RideWhereInput, limit: number): Promise<LeaderboardRow[]> {
    const groups = await this.prisma.ride.groupBy({
      by: ['wallet'],
      where: { status: 'completed', ...filter },
      _sum: { lastS: true },
      _count: { _all: true },
      _min: { endedAt: true },
      orderBy: [{ _sum: { lastS: 'desc' } }, { _count: { wallet: 'desc' } }, { _min: { endedAt: 'asc' } }, { wallet: 'asc' }],
      take: limit,
    });
    return groups.map((g) => ({ wallet: g.wallet, distance: g._sum.lastS ?? 0, rides: g._count._all }));
  }
}
