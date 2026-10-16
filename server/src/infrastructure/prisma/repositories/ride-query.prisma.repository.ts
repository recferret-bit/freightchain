import { badgeRejected } from '../../../domain/achievements/achievements.js';
import { Injectable } from '@nestjs/common';
import { Prisma, type RideStatus as RideStatusRow } from '@prisma/client';
import type { LeaderboardBoard, LeaderboardSort } from '../../../domain/economy/economy.dto.js';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';
import {
  type RejudgeFilter,
  RideQueryPort, type FinishedRideRow, type HistoryFilter, type HistoryRideRow, type LeaderboardEntry, type LeaderboardPage, type LeaderboardRow, type LiveRideRow, type RecentRideRow, type RideSummary, type UpcomingRideRow,
} from '../../../application/ports/rides/ride-query.port.js';
import { completedLevels } from '../../../domain/rides/ride-trip.js';
import { PrismaService } from '../prisma.service.js';

const CLEAN_HULL = 99.5;
const NIGHT_SHARE = 0.5;
const SIBERIA = 'siberia';

/** The read side over rides: projections that no aggregate needs. */
/** Same order as compareLeaderboard (domain/economy/leaderboard-order.ts). Null hull sorts last. */
const ORDER: Record<LeaderboardSort, Prisma.Sql> = {
  distance: Prisma.sql`distance DESC, rides DESC, first_end ASC, wallet ASC`,
  time: Prisma.sql`seconds DESC, distance DESC, rides DESC, first_end ASC, wallet ASC`,
  hull: Prisma.sql`hull DESC NULLS LAST, distance DESC, rides DESC, first_end ASC, wallet ASC`,
  rides: Prisma.sql`rides DESC, distance DESC, first_end ASC, wallet ASC`,
};

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
    const [started, done, honk] = await Promise.all([
      this.prisma.ride.aggregate({ where: { wallet, startedAt: { not: null } }, _count: { _all: true }, _sum: { lastS: true } }),
      this.prisma.ride.findMany({ where: { wallet, status: 'completed' }, select: { tier: true, trip: true, assist: true, lastS: true, hull: true, route: true, nightSeconds: true, driveSeconds: true, verdict: { select: { status: true, reasons: true } } } }),
      this.prisma.honkMint.findMany({ where: { wallet, amount: { gt: 0 } }, select: { band100: true } }),
    ]);
    // the badges' rides: a ride the verdict rejected (achievements.ts badgeRejected) earns no completion badge and its metres don't count – its START still
    // does (starting is not a judged fact). Verdicts are only ever on completed rides, so the rejected ones are a part of `done` and come off the metres.
    const metres = started._sum.lastS ?? 0, rejected = opts.skipRejected ? done.filter((r) => badgeRejected(r.verdict)) : [], fair = rejected.length ? done.filter((r) => !rejected.includes(r)) : done;
    return {
      stats: { started: started._count._all, completed: done.length, metres, best: done.reduce((max, r) => Math.max(max, r.lastS), 0) },
      facts: {
        started: started._count._all, paidShifts: fair.filter((r) => r.tier !== 'free').length, totalMetres: metres - rejected.reduce((sum, r) => sum + r.lastS, 0),
        nightShifts: fair.filter((r) => r.driveSeconds > 0 && r.nightSeconds >= NIGHT_SHARE * r.driveSeconds).length, // most of the shift in the dark: pressing N just before the end doesn't count
        cleanRuns: fair.filter((r) => r.hull !== null && r.hull >= CLEAN_HULL).length,
        siberiaShifts: fair.filter((r) => r.route === SIBERIA).length,
        freeUnassisted: fair.filter((r) => r.tier === 'free' && !r.assist).length,
        completedFreeLevels: completedLevels(fair),
        honkMints: honk.length, honkFinishes: honk.filter((m) => m.band100).length,
      },
    };
  }

  async recent(wallet: string, limit: number): Promise<RecentRideRow[]> {
    const rows = await this.prisma.ride.findMany({ where: { wallet, startedAt: { not: null } }, orderBy: [{ startedAt: 'desc' }, { seq: 'desc' }], take: limit, include: { verdict: { select: { status: true, overriddenBy: true } } } });
    return rows.flatMap((r) => (r.startedAt
      ? [{ tier: r.tier, status: r.status, lastS: r.lastS, hull: r.hull, route: r.route, timeScale: r.timeScale, startedAt: r.startedAt, endedAt: r.endedAt, verdict: r.verdict?.status ?? null, overridden: (r.verdict?.overriddenBy ?? null) !== null }]
      : []));
  }

  async leaderboard(board: LeaderboardBoard, roundId: number | null, verifiedOnly: boolean, trip: string | null, tier: PaidTierId | null, sort: LeaderboardSort, offset: number, limit: number, cap: number): Promise<LeaderboardPage> {
    return this.ranked(this.boardWhere(board, roundId, verifiedOnly, trip, tier), sort, offset, limit, cap);
  }

  async leaderboardPlace(board: LeaderboardBoard, roundId: number | null, verifiedOnly: boolean, trip: string | null, tier: PaidTierId | null, wallet: string, sort: LeaderboardSort): Promise<LeaderboardEntry | null> {
    const rows = await this.prisma.$queryRaw<RawRank[]>`
      WITH grouped AS (${this.grouped(this.boardWhere(board, roundId, verifiedOnly, trip, tier))}),
      ranked AS (SELECT wallet, distance, seconds, rides, hull, ROW_NUMBER() OVER (ORDER BY ${ORDER[sort]})::int AS rank FROM grouped)
      SELECT wallet, distance, seconds, rides, hull, rank FROM ranked WHERE wallet = ${wallet}`;
    return rows[0] ? toEntry(rows[0]) : null;
  }

  /** A pool's results count only the rides that ENDED by its play deadline (Pool.rideWindow – audit H6: a ride started days later still ranked and was paid). */
  async poolRanking(poolId: number, limit: number, verifiedOnly: boolean): Promise<LeaderboardRow[]> {
    const inWindow = Prisma.sql`r."poolId" = ${poolId} AND r."endedAt" <= (SELECT p."playDeadline" FROM "economy"."Pool" p WHERE p.id = ${poolId})`;
    const page = await this.ranked(this.paidWhere(inWindow, verifiedOnly), 'distance', 0, limit, limit);
    return page.rows.map(({ wallet, distance, seconds, hull, rides }) => ({ wallet, distance, seconds, hull, rides }));
  }

  /** (a ride that ended after the play deadline counts for nothing, so it never holds the payout up) */
  async poolUnreviewed(poolId: number, limit: number): Promise<{ id: string; wallet: string; verdict: string | null }[]> {
    const endBy = (await this.prisma.pool.findUnique({ where: { id: poolId }, select: { playDeadline: true } }))?.playDeadline;
    const rows = await this.prisma.ride.findMany({
      where: { poolId, status: 'completed', ...(endBy ? { endedAt: { lte: endBy } } : {}), OR: [{ verdict: { is: null } }, { verdict: { is: { status: { not: 'verified' }, overriddenBy: null } } }] },
      orderBy: [{ endedAt: 'asc' }, { seq: 'asc' }], take: limit, include: { verdict: { select: { status: true } } },
    });
    return rows.map((r) => ({ id: r.id, wallet: r.wallet, verdict: r.verdict?.status ?? null }));
  }

  async forRejudge(f: RejudgeFilter): Promise<{ id: string; verdict: string | null }[]> {
    const byVerdict: Prisma.RideWhereInput = f.verdict === 'all' ? {} : f.verdict === 'unjudged' ? { verdict: { is: null } } : { verdict: { is: { status: f.verdict } } };
    // a pool whose payout plan exists is decided: its rides are never judged again (a new rule must not move money already planned or paid)
    const planned = (await this.prisma.poolPayout.findMany({ distinct: ['poolId'], select: { poolId: true } })).map((p) => p.poolId);
    const rows = await this.prisma.ride.findMany({
      where: { status: 'completed', ...byVerdict, ...(f.since ? { endedAt: { gte: f.since } } : {}), ...(planned.length ? { OR: [{ poolId: null }, { poolId: { notIn: planned } }] } : {}) },
      orderBy: [{ endedAt: 'asc' }, { seq: 'asc' }], take: f.limit, include: { verdict: { select: { status: true } } },
    });
    return rows.map((r) => ({ id: r.id, verdict: r.verdict?.status ?? null }));
  }

  /** Paid boards count a verified recording only (unless shadow mode). The free board counts every completed ride on its trip. */
  private boardWhere(board: LeaderboardBoard, roundId: number | null, verifiedOnly: boolean, trip: string | null, tier: PaidTierId | null): Prisma.Sql {
    if (board === 'free') return Prisma.sql`r."tier" = 'free' AND r."trip" = ${trip ?? ''}`;
    const shift = tier ? Prisma.sql`r."tier" = ${tier}` : Prisma.sql`r."tier" <> 'free'`;
    const round = board !== 'round' ? Prisma.empty : roundId == null ? Prisma.sql`AND r."roundId" IS NULL` : Prisma.sql`AND r."roundId" = ${roundId}`;
    return this.paidWhere(Prisma.sql`${shift} ${round}`, verifiedOnly);
  }

  private paidWhere(match: Prisma.Sql, verifiedOnly: boolean): Prisma.Sql {
    const verified = verifiedOnly
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "verdict"."RideVerdict" v WHERE v."rideId" = r.id AND v.status::text = 'verified')`
      : Prisma.empty;
    return Prisma.sql`${match} ${verified}`;
  }

  /** Hull is the one left on the furthest shift (greatest distance, then the later finish, then the later insert) — not the best hull. */
  private grouped(where: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
      SELECT r.wallet AS wallet, SUM(r."lastS")::float8 AS distance, SUM(r."driveSeconds")::float8 AS seconds, COUNT(*)::int AS rides, MIN(r."endedAt") AS first_end,
             (ARRAY_AGG(r.hull ORDER BY r."lastS" DESC, r."endedAt" DESC NULLS LAST, r.seq DESC))[1]::float8 AS hull
      FROM "ride"."Ride" r WHERE r.status::text = 'completed' AND ${where} GROUP BY r.wallet`;
  }

  private async ranked(where: Prisma.Sql, sort: LeaderboardSort, offset: number, limit: number, cap: number): Promise<LeaderboardPage> {
    const rows = await this.prisma.$queryRaw<RawRank[]>`
      WITH grouped AS (${this.grouped(where)}),
      ranked AS (
        SELECT wallet, distance, seconds, rides, hull, ROW_NUMBER() OVER (ORDER BY ${ORDER[sort]})::int AS rank, COUNT(*) OVER ()::int AS total FROM grouped
      )
      SELECT wallet, distance, seconds, rides, hull, rank, total FROM ranked
      WHERE rank > ${offset} AND rank <= LEAST(${offset + limit}, ${cap}) ORDER BY rank`;
    if (rows.length) return { rows: rows.map(toEntry), total: num(rows[0]?.total) };
    const [count] = await this.prisma.$queryRaw<{ total: number }[]>`WITH grouped AS (${this.grouped(where)}) SELECT COUNT(*)::int AS total FROM grouped`;
    return { rows: [], total: num(count?.total) };
  }
}

interface RawRank { wallet: string; distance: unknown; seconds: unknown; rides: unknown; hull: unknown; rank: unknown; total?: unknown }
const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : 0; };
const toEntry = (r: RawRank): LeaderboardEntry => ({
  wallet: r.wallet, distance: num(r.distance), seconds: num(r.seconds), rides: num(r.rides), rank: num(r.rank),
  hull: r.hull == null ? null : num(r.hull),
});
