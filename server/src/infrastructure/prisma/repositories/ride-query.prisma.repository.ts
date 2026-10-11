import { badgeRejected } from '../../../domain/achievements/achievements.js';
import { Injectable } from '@nestjs/common';
import type { Prisma, RideStatus as RideStatusRow } from '@prisma/client';
import type { LeaderboardBoard } from '../../../domain/economy/economy.dto.js';
import {
  type RejudgeFilter,
  RideQueryPort, type FinishedRideRow, type HistoryFilter, type HistoryRideRow, type LeaderboardRow, type LiveRideRow, type RecentRideRow, type RideSummary, type UpcomingRideRow,
} from '../../../application/ports/rides/ride-query.port.js';
import { completedLevels } from '../../../domain/rides/ride-trip.js';
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
      where: { status: 'running', tier: { not: 'free' }, lastHbAt: { gte: heartbeatSince } },
      orderBy: [{ startedAt: 'desc' }, { seq: 'desc' }],
      take: limit,
    });
    return rows.flatMap((r) => (r.startedAt && r.lastHbAt
      ? [{ id: r.id, wallet: r.wallet, tier: r.tier, route: r.route, minSeconds: r.minSeconds, completeDist: r.completeDist, driveSeconds: r.driveSeconds, lastS: r.lastS, hull: r.hull,
        paused: r.paused, timeScale: r.timeScale, startedAt: r.startedAt, lastHbAt: r.lastHbAt }]
      : []));
  }

  /** One query: the page of ended rides + whether each still has a recording (a relation count, no N+1). Uses the (status, endedAt) index. */
  async history(f: HistoryFilter): Promise<HistoryRideRow[]> {
    const ended = f.status ? [f.status] : ['completed', 'abandoned', 'failed'];
    const rows = await this.prisma.ride.findMany({
      where: {
        status: { in: ended as RideStatusRow[] }, startedAt: { not: null }, endedAt: { not: null }, ...(f.wallet ? { wallet: f.wallet } : {}),
        ...(f.before ? { OR: [{ endedAt: { lt: f.before.endedAt } }, { endedAt: f.before.endedAt, seq: { lt: f.before.seq } }] } : {}),
      },
      orderBy: [{ endedAt: 'desc' }, { seq: 'desc' }], take: f.limit,
      include: { _count: { select: { batches: true } } },
    });
    return rows.map((r) => ({
      id: r.id, seq: r.seq, wallet: r.wallet, tier: r.tier, route: r.route, status: r.status, reason: r.reason, lastS: r.lastS, driveSeconds: r.driveSeconds,
      minSeconds: r.minSeconds, timeScale: r.timeScale, startedAt: r.startedAt as Date, endedAt: r.endedAt as Date, recorded: r._count.batches > 0,
    }));
  }

  async staleRunning(cutoff: Date, limit: number): Promise<{ id: string; wallet: string }[]> {
    return this.prisma.ride.findMany({ where: { status: 'running', OR: [{ lastHbAt: { lt: cutoff } }, { lastHbAt: null }] }, orderBy: [{ lastHbAt: { sort: 'asc', nulls: 'first' } }], take: limit, select: { id: true, wallet: true } });
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
    return rows.map((r) => ({ id: r.id, wallet: r.wallet, tier: r.tier, route: r.route, status: r.status, lastS: r.lastS, endedAt: r.endedAt }));
  }

  /** Two queries: one aggregate over the started rides, and the completed rides themselves (few per wallet) for the per-ride achievement facts. */
  async summary(wallet: string, opts: { skipRejected?: boolean } = {}): Promise<RideSummary> {
    const [started, done] = await Promise.all([
      this.prisma.ride.aggregate({ where: { wallet, startedAt: { not: null } }, _count: { _all: true }, _sum: { lastS: true } }),
      this.prisma.ride.findMany({ where: { wallet, status: 'completed' }, select: { tier: true, trip: true, assist: true, lastS: true, hull: true, route: true, nightSeconds: true, driveSeconds: true, verdict: { select: { status: true, reasons: true } } } }),
    ]);
    // the badges' rides: a ride the verdict rejected (achievements.ts badgeRejected) earns no completion badge and its metres don't count – its START still
    // does (starting is not a judged fact). Verdicts are only ever on completed rides, so the rejected ones are a part of `done` and come off the metres.
    const metres = started._sum.lastS ?? 0, rejected = opts.skipRejected ? done.filter((r) => badgeRejected(r.verdict)) : [], fair = rejected.length ? done.filter((r) => !rejected.includes(r)) : done;
    return {
      stats: { started: started._count._all, completed: done.length, metres, best: done.reduce((max, r) => Math.max(max, r.lastS), 0) },
      facts: {
        started: started._count._all, completed: fair.length, totalMetres: metres - rejected.reduce((sum, r) => sum + r.lastS, 0),
        completedAtNight: fair.some((r) => r.driveSeconds > 0 && r.nightSeconds >= NIGHT_SHARE * r.driveSeconds), // most of the shift in the dark: pressing N just before the end doesn't count
        cleanRun: fair.some((r) => r.hull !== null && r.hull >= CLEAN_HULL),
        completedSiberia: fair.some((r) => r.route === SIBERIA),
        completedFreeUnassisted: fair.some((r) => r.tier === 'free' && !r.assist),
        completedFreeLevels: completedLevels(fair),
      },
    };
  }

  async recent(wallet: string, limit: number): Promise<RecentRideRow[]> {
    const rows = await this.prisma.ride.findMany({ where: { wallet, startedAt: { not: null } }, orderBy: [{ startedAt: 'desc' }, { seq: 'desc' }], take: limit, include: { verdict: { select: { status: true, overriddenBy: true } } } });
    return rows.flatMap((r) => (r.startedAt
      ? [{ tier: r.tier, status: r.status, lastS: r.lastS, hull: r.hull, route: r.route, timeScale: r.timeScale, startedAt: r.startedAt, endedAt: r.endedAt, verdict: r.verdict?.status ?? null, overridden: (r.verdict?.overriddenBy ?? null) !== null }]
      : []));
  }

  async leaderboard(board: LeaderboardBoard, roundId: number | null, limit: number, verifiedOnly: boolean, trip: string | null): Promise<LeaderboardRow[]> {
    const tierFilter: Prisma.RideWhereInput = board === 'free' ? { tier: 'free', trip: trip ?? '' } : { tier: { not: 'free' }, ...(verifiedOnly ? VERIFIED : {}), ...(board === 'round' ? { roundId } : {}) }; // paid boards: verified recordings only (unless shadow mode)
    return this.ranked(tierFilter, limit);
  }

  async poolRanking(poolId: number, limit: number, verifiedOnly: boolean): Promise<LeaderboardRow[]> {
    return this.ranked({ poolId, ...(verifiedOnly ? VERIFIED : {}) }, limit);
  }

  async poolUnreviewed(poolId: number, limit: number): Promise<{ id: string; wallet: string; verdict: string | null }[]> {
    const rows = await this.prisma.ride.findMany({
      where: { poolId, status: 'completed', OR: [{ verdict: { is: null } }, { verdict: { is: { status: { not: 'verified' }, overriddenBy: null } } }] },
      orderBy: [{ endedAt: 'asc' }, { seq: 'asc' }], take: limit, include: { verdict: { select: { status: true } } },
    });
    return rows.map((r) => ({ id: r.id, wallet: r.wallet, verdict: r.verdict?.status ?? null }));
  }

  async forRejudge(f: RejudgeFilter): Promise<{ id: string; verdict: string | null }[]> {
    const byVerdict: Prisma.RideWhereInput = f.verdict === 'all' ? {} : f.verdict === 'unjudged' ? { verdict: { is: null } } : { verdict: { is: { status: f.verdict } } };
    const rows = await this.prisma.ride.findMany({
      where: { status: 'completed', ...byVerdict, ...(f.since ? { endedAt: { gte: f.since } } : {}) },
      orderBy: [{ endedAt: 'asc' }, { seq: 'asc' }], take: f.limit, include: { verdict: { select: { status: true } } },
    });
    return rows.map((r) => ({ id: r.id, verdict: r.verdict?.status ?? null }));
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
