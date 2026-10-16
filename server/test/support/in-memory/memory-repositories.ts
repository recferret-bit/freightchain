import { Injectable } from '@nestjs/common';
import { AchievementUnlock } from '../../../src/domain/achievements/achievement-unlock.entity.js';
import type { AuthChallenge } from '../../../src/domain/auth/auth-challenge.entity.js';
import type { LeaderboardBoard, LeaderboardSort } from '../../../src/domain/economy/economy.dto.js';
import type { PaidTierId } from '../../../src/domain/rides/ride-tier.js';
import { compareLeaderboard, type LeaderboardKeys } from '../../../src/domain/economy/leaderboard-order.js';
import type { Payment } from '../../../src/domain/economy/payment.entity.js';
import { Round, type RoundProps } from '../../../src/domain/economy/round.entity.js';
import { Player } from '../../../src/domain/players/player.entity.js';
import { Ride, type RideProps } from '../../../src/domain/rides/ride.entity.js';
import { OPEN_RIDE_STATUSES, RideStatus } from '../../../src/domain/rides/ride-status.js';
import { completedLevels } from '../../../src/domain/rides/ride-trip.js';
import { ConflictError, VersionConflictError } from '../../../src/domain/shared/errors.js';
import { AchievementMintRepositoryPort } from '../../../src/application/ports/achievements/achievement-mint.repository.port.js';
import { MAX_MINT_ATTEMPTS, type AchievementMintRecord } from '../../../src/domain/achievements/achievement-mint.js';
import { AchievementRepositoryPort } from '../../../src/application/ports/achievements/achievement.repository.port.js';
import { ChallengeRepositoryPort } from '../../../src/application/ports/auth/challenge.repository.port.js';
import { PaymentRepositoryPort } from '../../../src/application/ports/economy/payment.repository.port.js';
import { RoundRepositoryPort, type RoundEntries } from '../../../src/application/ports/economy/round.repository.port.js';
import { HealthProbePort } from '../../../src/application/ports/health/health-probe.port.js';
import { PlayerRepositoryPort } from '../../../src/application/ports/players/player.repository.port.js';
import { RideQueryPort, type FinishedRideRow, type LeaderboardEntry, type LeaderboardPage, type LeaderboardRow, type LiveRideRow, type RecentRideRow, type RideSummary, type UpcomingRideRow , type HistoryFilter, type HistoryRideRow, type RejudgeFilter } from '../../../src/application/ports/rides/ride-query.port.js';
import { RideRepositoryPort } from '../../../src/application/ports/rides/ride.repository.port.js';
import { TransactionPort } from '../../../src/application/ports/shared/transaction.port.js';
import { RideBatchRepositoryPort } from '../../../src/application/ports/telemetry/ride-batch.repository.port.js';
import { RideBatch, type BatchFacts } from '../../../src/domain/telemetry/ride-batch.entity.js';
import { RideVerdictRepositoryPort } from '../../../src/application/ports/verdict/ride-verdict.repository.port.js';
import { RideVerdict } from '../../../src/domain/verdict/ride-verdict.entity.js';
import { RideReplayRepositoryPort } from '../../../src/application/ports/verdict/ride-replay.repository.port.js';
import { RideReplay } from '../../../src/domain/verdict/ride-replay.entity.js';
import { VerdictStatus } from '../../../src/domain/verdict/verdict.dto.js';
import { badgeRejected } from '../../../src/domain/achievements/achievements.js';

/** a pool's results count only the rides that ended by its play deadline (the Prisma repositories' H6 rule) */
const inWindow = (db: MemoryDb, r: { poolId: number | null; endedAt: Date | null }): boolean => {
  const pool = r.poolId === null ? undefined : db.pools.get(r.poolId);
  return !pool || (r.endedAt !== null && r.endedAt.getTime() <= pool.playDeadline.getTime());
};
import { SignInRepositoryPort, type SignInSummary } from '../../../src/application/ports/auth/sign-in.repository.port.js';
import type { PoolRideFacts } from '../../../src/domain/verdict/pool-attention.js';
import { AdminActionRepositoryPort } from '../../../src/application/ports/admin/admin-action.repository.port.js';
import { AdminDirectoryPort } from '../../../src/application/ports/admin/admin-directory.port.js';
import type { PoolProps } from '../../../src/domain/economy/pool.types.js';
import type { StatsTotals } from '../../../src/domain/stats/stats.js';
import { AdminQueryPort, type AdminCounts, type AdminRideRow } from '../../../src/application/ports/admin/admin-query.port.js';
import type { SignInRecord } from '../../../src/domain/auth/sign-in.js';
import type { AdminActionRecord, AdminBatchDto, AdminRideFilter } from '../../../src/domain/admin/admin.dto.js';
import { MemoryDb } from './memory-db.js';

/* In-memory twins of the Prisma repositories: same contracts (optimistic versions, unique keys, orderings), no database.
   The HTTP suite runs on these (no Docker); the integration suite runs the SAME scenarios on the real Prisma repositories. */

@Injectable()
export class MemoryTransaction extends TransactionPort {
  run<T>(fn: (tx: never) => Promise<T>): Promise<T> {
    return fn(undefined as never); // no rollback here – the Postgres suite covers atomicity
  }
}

@Injectable()
export class MemoryHealthProbe extends HealthProbePort {
  async pingDatabase(): Promise<number> { return 1; }
}

@Injectable()
export class MemoryPlayerRepository extends PlayerRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async findByWallet(wallet: string): Promise<Player | null> {
    const p = this.db.players.get(wallet);
    return p ? Player.restore(p) : null;
  }

  findByWalletForUpdate(wallet: string): Promise<Player | null> { return this.findByWallet(wallet); }

  async insertIfAbsent(player: Player): Promise<boolean> {
    if (this.db.players.has(player.wallet)) return false;
    this.db.players.set(player.wallet, player.snapshot());
    return true;
  }

  async grantDailyFreeRides(today: string, cap: number): Promise<number> {
    let touched = 0;
    for (const [wallet, p] of [...this.db.players].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (p.freeDay >= today) continue;
      this.db.players.set(wallet, { ...p, freeRides: p.freeRides < cap ? p.freeRides + 1 : p.freeRides, freeRidesMax: cap, freeDay: today, version: p.version + 1 });
      touched++;
    }
    return touched;
  }

  async save(player: Player): Promise<Player> {
    const s = player.snapshot();
    if (this.db.players.get(s.wallet)?.version !== s.version) throw new VersionConflictError();
    const next = { ...s, version: s.version + 1 };
    this.db.players.set(s.wallet, next);
    return Player.restore(next);
  }
}

@Injectable()
export class MemoryChallengeRepository extends ChallengeRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async upsert(challenge: AuthChallenge): Promise<void> { this.db.challenges.set(challenge.wallet, challenge); }

  async consume(key: string): Promise<AuthChallenge | null> {
    const c = this.db.challenges.get(key) ?? null;
    this.db.challenges.delete(key);
    return c;
  }
}

const OPEN_PRIORITY: Partial<Record<RideStatus, number>> = { [RideStatus.Running]: 0, [RideStatus.Created]: 1, [RideStatus.AwaitingPayment]: 2 };

@Injectable()
export class MemoryRideRepository extends RideRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  private newestFirst(wallet: string): Ride[] {
    return [...this.db.rides.values()]
      .filter((r) => r.props.wallet === wallet)
      .sort((a, b) => b.props.createdAt.getTime() - a.props.createdAt.getTime() || b.seq - a.seq)
      .map((r) => Ride.restore(r.props));
  }

  async findById(id: string): Promise<Ride | null> {
    const r = this.db.rides.get(id);
    return r ? Ride.restore(r.props) : null;
  }

  async findOpenByWallet(wallet: string): Promise<Ride | null> {
    return (await this.listOpenByWallet(wallet))[0] ?? null;
  }

  async listOpenByWallet(wallet: string): Promise<Ride[]> {
    const open = this.newestFirst(wallet).filter((r) => OPEN_RIDE_STATUSES.includes(r.status));
    return open.sort((a, b) => (OPEN_PRIORITY[a.status] ?? 9) - (OPEN_PRIORITY[b.status] ?? 9));
  }

  async findPendingPaid(wallet: string, since: Date): Promise<Ride | null> {
    const pending = this.newestFirst(wallet).filter((r) =>
      !r.isFree && (r.isInStatus(RideStatus.AwaitingPayment, RideStatus.Created) || (r.isInStatus(RideStatus.Expired) && r.snapshot().createdAt.getTime() > since.getTime())));
    return pending.sort((a, b) => Number(b.status === RideStatus.Created) - Number(a.status === RideStatus.Created))[0] ?? null;
  }

  async insert(ride: Ride): Promise<void> {
    this.db.rides.set(ride.id, { props: ride.snapshot(), seq: this.db.nextSeq() });
  }

  async save(ride: Ride): Promise<Ride> {
    const s = ride.snapshot();
    const stored = this.db.rides.get(s.id);
    if (!stored || stored.props.version !== s.version) throw new VersionConflictError();
    const next = { ...s, version: s.version + 1 };
    this.db.rides.set(s.id, { props: next, seq: stored.seq });
    return Ride.restore(next);
  }

  async findBestVerifiedByPoolAndWallet(poolId: number, wallet: string): Promise<Ride | null> {
    const verified = [...this.db.rides.values()]
      .filter((r) => r.props.wallet === wallet && r.props.poolId === poolId && r.props.status === RideStatus.Completed && inWindow(this.db, r.props))
      .filter((r) => {
        const v = this.db.verdicts.get(r.props.id);
        return v ? v.status === 'verified' : false;
      })
      .sort((a, b) => b.props.lastS - a.props.lastS || a.props.driveSeconds - b.props.driveSeconds);
    return verified[0] ? Ride.restore(verified[0].props) : null;
  }

  async hasCompletedInPool(poolId: number, wallet: string): Promise<boolean> {
    return [...this.db.rides.values()].some((r) => r.props.wallet === wallet && r.props.poolId === poolId && r.props.status === RideStatus.Completed && inWindow(this.db, r.props));
  }
}

@Injectable()
export class MemoryRideQuery extends RideQueryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  private of(wallet: string) { return [...this.db.rides.values()].filter((r) => r.props.wallet === wallet); }

  async live(heartbeatSince: Date, limit: number): Promise<LiveRideRow[]> {
    return [...this.db.rides.values()]
      .filter((r) => r.props.status === RideStatus.Running && r.props.tier !== 'free' && r.props.lastHbAt && r.props.lastHbAt >= heartbeatSince)
      .sort((a, b) => (b.props.startedAt?.getTime() ?? 0) - (a.props.startedAt?.getTime() ?? 0) || b.seq - a.seq)
      .slice(0, limit)
      .flatMap(({ props: p }) => (p.startedAt && p.lastHbAt
        ? [{ id: p.id, wallet: p.wallet, tier: p.tier, route: p.route, minSeconds: p.minSeconds, completeDist: p.completeDist, driveSeconds: p.driveSeconds, lastS: p.lastS, hull: p.hull, paused: p.paused, timeScale: p.timeScale, startedAt: p.startedAt, lastHbAt: p.lastHbAt }]
        : []));
  }

  async history(f: HistoryFilter): Promise<HistoryRideRow[]> {
    const ended = f.status ? [f.status] : ['completed', 'abandoned', 'failed'];
    return [...this.db.rides.values()]
      .filter(({ props: p }) => ended.includes(p.status) && p.startedAt && p.endedAt && (!f.wallet || p.wallet === f.wallet))
      .filter(({ props: p, seq }) => !f.before || p.endedAt!.getTime() < f.before.endedAt.getTime() || (p.endedAt!.getTime() === f.before.endedAt.getTime() && BigInt(seq) < f.before.seq))
      .sort((a, b) => b.props.endedAt!.getTime() - a.props.endedAt!.getTime() || b.seq - a.seq).slice(0, f.limit)
      .map(({ props: p, seq }) => ({
        id: p.id, seq: BigInt(seq), wallet: p.wallet, tier: p.tier, route: p.route, status: p.status, reason: p.reason, lastS: p.lastS, driveSeconds: p.driveSeconds,
        minSeconds: p.minSeconds, timeScale: p.timeScale, startedAt: p.startedAt!, endedAt: p.endedAt!, recorded: [...this.db.batches.values()].some((b) => b.rideId === p.id),
      }));
  }

  async staleRunning(cutoff: Date, limit: number): Promise<{ id: string; wallet: string }[]> {
    return [...this.db.rides.values()].filter((r) => r.props.status === RideStatus.Running && (r.props.lastHbAt?.getTime() ?? 0) < cutoff.getTime())
      .sort((a, b) => (a.props.lastHbAt?.getTime() ?? 0) - (b.props.lastHbAt?.getTime() ?? 0)).slice(0, limit).map(({ props: p }) => ({ id: p.id, wallet: p.wallet }));
  }

  async upcoming(limit: number): Promise<UpcomingRideRow[]> {
    return [...this.db.rides.values()]
      .filter((r) => r.props.status === RideStatus.Created && r.props.tier !== 'free' && r.props.paidAt)
      .sort((a, b) => (b.props.paidAt?.getTime() ?? 0) - (a.props.paidAt?.getTime() ?? 0) || b.seq - a.seq)
      .slice(0, limit)
      .flatMap(({ props: p }) => (p.paidAt ? [{ wallet: p.wallet, tier: p.tier, minSeconds: p.minSeconds, paidAt: p.paidAt }] : []));
  }

  async finished(limit: number): Promise<FinishedRideRow[]> {
    const ended: string[] = [RideStatus.Completed, RideStatus.Abandoned, RideStatus.Failed];
    return [...this.db.rides.values()]
      .filter((r) => ended.includes(r.props.status) && r.props.startedAt)
      .sort((a, b) => (b.props.endedAt?.getTime() ?? Number.NEGATIVE_INFINITY) - (a.props.endedAt?.getTime() ?? Number.NEGATIVE_INFINITY) || b.seq - a.seq)
      .slice(0, limit)
      .map(({ props: p }) => ({ id: p.id, wallet: p.wallet, tier: p.tier, route: p.route, status: p.status, lastS: p.lastS, endedAt: p.endedAt }));
  }

  async summary(wallet: string, opts: { skipRejected?: boolean } = {}): Promise<RideSummary> {
    const rides = this.of(wallet).map((r) => r.props);
    const started = rides.filter((r) => r.startedAt);
    const done = rides.filter((r) => r.status === RideStatus.Completed);
    const metres = started.reduce((sum, r) => sum + r.lastS, 0), verdictOf = (id: string) => { const v = this.db.verdicts.get(id); return v ? { status: v.status, reasons: v.reasons } : null; };
    const rejected = opts.skipRejected ? done.filter((r) => badgeRejected(verdictOf(r.id))) : [], fair = done.filter((r) => !rejected.includes(r));   // a rejected ride earns no completion and its metres don't count (its start does)
    return {
      stats: { started: started.length, completed: done.length, metres, best: done.reduce((m, r) => Math.max(m, r.lastS), 0) },
      facts: {
        started: started.length, paidShifts: fair.filter((r) => r.tier !== 'free').length, totalMetres: metres - rejected.reduce((sum, r) => sum + r.lastS, 0),
        nightShifts: fair.filter((r) => r.driveSeconds > 0 && r.nightSeconds >= 0.5 * r.driveSeconds).length,
        cleanRuns: fair.filter((r) => r.hull !== null && r.hull >= 99.5).length,
        siberiaShifts: fair.filter((r) => r.route === 'siberia').length,
        freeUnassisted: fair.filter((r) => r.tier === 'free' && !r.assist).length,
        completedFreeLevels: completedLevels(fair),
        honkMints: [...this.db.honkMints.values()].filter((m) => m.wallet === wallet && m.amount > 0n).length,
        honkFinishes: [...this.db.honkMints.values()].filter((m) => m.wallet === wallet && m.amount > 0n && m.band100).length,
      },
    };
  }

  async recent(wallet: string, limit: number): Promise<RecentRideRow[]> {
    return this.of(wallet)
      .filter((r) => r.props.startedAt)
      .sort((a, b) => (b.props.startedAt?.getTime() ?? 0) - (a.props.startedAt?.getTime() ?? 0) || b.seq - a.seq)
      .slice(0, limit)
      .flatMap(({ props: p }) => (p.startedAt
        ? [{ tier: p.tier, status: p.status, lastS: p.lastS, hull: p.hull, route: p.route, timeScale: p.timeScale, startedAt: p.startedAt, endedAt: p.endedAt, verdict: this.db.verdicts.get(p.id)?.status ?? null, overridden: (this.db.verdicts.get(p.id)?.overriddenBy ?? null) !== null }]
        : []));
  }

  async leaderboard(board: LeaderboardBoard, roundId: number | null, verifiedOnly: boolean, trip: string | null, tier: PaidTierId | null, sort: LeaderboardSort, offset: number, limit: number, cap: number): Promise<LeaderboardPage> {
    return this.ranked((r) => this.onBoard(r, board, roundId, verifiedOnly, trip, tier), sort, offset, limit, cap);
  }

  async leaderboardPlace(board: LeaderboardBoard, roundId: number | null, verifiedOnly: boolean, trip: string | null, tier: PaidTierId | null, wallet: string, sort: LeaderboardSort): Promise<LeaderboardEntry | null> {
    return this.ranked((r) => this.onBoard(r, board, roundId, verifiedOnly, trip, tier), sort, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
      .rows.find((r) => r.wallet === wallet) ?? null;
  }

  private onBoard(r: RideProps, board: LeaderboardBoard, roundId: number | null, verifiedOnly: boolean, trip: string | null, tier: PaidTierId | null): boolean {
    if (board === 'free') return r.tier === 'free' && r.trip === (trip ?? '');
    return (tier ? r.tier === tier : r.tier !== 'free') && (!verifiedOnly || this.verified(r)) && (board === 'round' ? r.roundId === roundId : true);
  }

  async poolRanking(poolId: number, limit: number, verifiedOnly: boolean): Promise<LeaderboardRow[]> {
    const page = this.ranked((r) => r.poolId === poolId && inWindow(this.db, r) && (!verifiedOnly || this.verified(r)), 'distance', 0, limit, limit);
    return page.rows.map(({ wallet, distance, seconds, hull, rides }) => ({ wallet, distance, seconds, hull, rides }));
  }

  async poolUnreviewed(poolId: number, limit: number): Promise<{ id: string; wallet: string; verdict: string | null }[]> {
    return [...this.db.rides.values()]
      .filter(({ props: r }) => {
        const v = this.db.verdicts.get(r.id);
        return r.poolId === poolId && r.status === RideStatus.Completed && inWindow(this.db, r) && (!v || (v.status !== VerdictStatus.Verified && v.overriddenBy === null));
      })
      .sort((a, b) => (a.props.endedAt?.getTime() ?? 0) - (b.props.endedAt?.getTime() ?? 0) || a.seq - b.seq)
      .slice(0, limit).map(({ props: r }) => ({ id: r.id, wallet: r.wallet, verdict: this.db.verdicts.get(r.id)?.status ?? null }));
  }

  private verified(r: RideProps): boolean { return this.db.verdicts.get(r.id)?.status === VerdictStatus.Verified; }

  async forRejudge(f: RejudgeFilter): Promise<{ id: string; verdict: string | null }[]> {
    return [...this.db.rides.values()]
      .filter(({ props: r }) => r.status === RideStatus.Completed && (!f.since || (r.endedAt?.getTime() ?? 0) >= f.since.getTime()) && !(r.poolId !== null && [...this.db.poolPayouts.values()].some((p) => p.poolId === r.poolId)))
      .map(({ props: r, seq }) => ({ id: r.id, verdict: this.db.verdicts.get(r.id)?.status ?? null, endedAt: r.endedAt?.getTime() ?? 0, seq }))
      .filter((r) => f.verdict === 'all' || (f.verdict === 'unjudged' ? r.verdict === null : r.verdict === f.verdict))
      .sort((a, b) => a.endedAt - b.endedAt || a.seq - b.seq).slice(0, f.limit).map(({ id, verdict }) => ({ id, verdict }));
  }

  /** Hull is the one left on the furthest shift (greatest distance, then the later finish, then the later insert) — the SQL ARRAY_AGG order. */
  private ranked(keep: (r: RideProps) => boolean, sort: LeaderboardSort, offset: number, limit: number, cap: number): LeaderboardPage {
    const groups = new Map<string, LeaderboardKeys & { bestS: number; bestAt: number; bestSeq: number }>();
    for (const { props: r, seq } of this.db.rides.values()) {
      if (r.status !== RideStatus.Completed || !keep(r)) continue;
      const g = groups.get(r.wallet) ?? { wallet: r.wallet, distance: 0, seconds: 0, hull: null, rides: 0, first: Number.POSITIVE_INFINITY, bestS: -1, bestAt: -1, bestSeq: -1 };
      g.distance += r.lastS; g.seconds += r.driveSeconds; g.rides += 1; g.first = Math.min(g.first, r.endedAt?.getTime() ?? Number.POSITIVE_INFINITY);
      const at = r.endedAt?.getTime() ?? -1;
      if (r.lastS > g.bestS || (r.lastS === g.bestS && (at > g.bestAt || (at === g.bestAt && seq >= g.bestSeq)))) { g.bestS = r.lastS; g.bestAt = at; g.bestSeq = seq; g.hull = r.hull; }
      groups.set(r.wallet, g);
    }
    const sorted = [...groups.values()].sort((a, b) => compareLeaderboard(sort, a, b));
    const from = offset, to = Math.min(offset + limit, cap);
    return { total: sorted.length, rows: sorted.slice(from, Math.max(from, to)).map((g, i) => ({ wallet: g.wallet, distance: g.distance, seconds: g.seconds, hull: g.hull, rides: g.rides, rank: from + i + 1 })) };
  }
}

@Injectable()
export class MemoryRoundRepository extends RoundRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async lockOpen(roundId: number): Promise<boolean> {
    return this.db.rounds.find((r) => r.id === roundId)?.status === 'open';
  }

  async findContaining(at: Date): Promise<Round | null> {
    const hit = [...this.db.rounds].reverse().find((r) => r.startsAt <= at && at < r.endsAt);
    return hit ? Round.restore(hit) : null;
  }

  async findLatest(): Promise<Round | null> {
    const latest = [...this.db.rounds].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0];
    return latest ? Round.restore(latest) : null;
  }

  async insert(round: Round): Promise<Round | null> {
    const s = round.snapshot();
    if (this.db.rounds.some((r) => r.startsAt.getTime() === s.startsAt.getTime())) return null;
    const stored: RoundProps = { ...s, id: this.db.nextRoundId() };
    this.db.rounds.push(stored);
    return Round.restore(stored);
  }

  async save(round: Round): Promise<void> {
    const stored = this.db.rounds.find((r) => r.id === round.id);
    if (stored) stored.status = round.status;
  }

  async entriesOf(roundId: number): Promise<RoundEntries> {
    const entries = this.db.payments.filter((p) => p.roundId === roundId);
    return { lamports: entries.reduce((sum, p) => sum + p.lamports, 0), count: entries.length };
  }
}

@Injectable()
export class MemoryPaymentRepository extends PaymentRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async findBySignature(signature: string): Promise<Payment | null> { return this.db.payments.find((p) => p.signature === signature) ?? null; }
  async findByRide(rideId: string): Promise<Payment | null> { return this.db.payments.find((p) => p.rideId === rideId) ?? null; }

  async insert(payment: Payment): Promise<void> {
    if (this.db.payments.some((p) => p.signature === payment.signature || p.rideId === payment.rideId)) throw new ConflictError('this transaction already paid for a ride');
    this.db.payments.push(payment);
  }

  async totalsOf(wallet: string): Promise<{ lamports: number; count: number }> {
    const mine = this.db.payments.filter((p) => p.wallet === wallet);
    return { lamports: mine.reduce((sum, p) => sum + p.lamports, 0), count: mine.length };
  }
}

@Injectable()
export class MemoryRideBatchRepository extends RideBatchRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async insert(batch: RideBatch): Promise<boolean> {
    const key = `${batch.rideId}:${batch.seq}`;
    if (this.db.batches.has(key)) return false;
    this.db.batches.set(key, batch.snapshot());
    return true;
  }

  async deleteForRidesEndedBefore(cutoff: Date): Promise<number> {
    let deleted = 0;
    for (const [key, b] of this.db.batches) {
      const ride = this.db.rides.get(b.rideId)?.props;
      const verdict = this.db.verdicts.get(b.rideId);
      const pool = ride?.poolId == null ? undefined : this.db.pools.get(ride.poolId);
      if (!ride?.endedAt || ride.endedAt.getTime() >= cutoff.getTime() || verdict?.status === VerdictStatus.Flagged || (!verdict && ride.status === RideStatus.Completed)) continue;
      if (pool && (pool.status === 'open' || pool.status === 'active')) continue;   // a live pool's attestations need the recording
      this.db.batches.delete(key);
      deleted++;
    }
    return deleted;
  }

  async listByRide(rideId: string): Promise<RideBatch[]> {
    return [...this.db.batches.values()].filter((b) => b.rideId === rideId).sort((a, b) => a.seq - b.seq).map((b) => RideBatch.restore(b));
  }

  async listFactsByRide(rideId: string): Promise<BatchFacts[]> {
    return (await this.listByRide(rideId)).map((b) => ({ seq: b.seq, prevHash: b.prevHash, hash: b.hash, hashOk: b.hashOk, serverHash: b.serverHash, t0: b.t0, t1: b.t1, summary: b.summary, receivedAt: b.receivedAt }));
  }

  async totalBytes(rideId: string): Promise<number> {
    return [...this.db.batches.values()].filter((b) => b.rideId === rideId).reduce((n, b) => n + b.bytes, 0);
  }

  async listFrom(rideId: string, fromSeq: number, limit: number): Promise<RideBatch[]> {
    return (await this.listByRide(rideId)).filter((b) => b.seq >= fromSeq).slice(0, limit);
  }

  async extent(rideId: string): Promise<{ lastSeq: number | null; t1: number }> {
    const all = [...this.db.batches.values()].filter((b) => b.rideId === rideId);
    return { lastSeq: all.length ? Math.max(...all.map((b) => b.seq)) : null, t1: all.length ? Math.max(...all.map((b) => b.t1)) : 0 };
  }
}

@Injectable()
export class MemoryRideVerdictRepository extends RideVerdictRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async save(verdict: RideVerdict): Promise<void> {
    const prev = this.db.verdicts.get(verdict.rideId);
    this.db.verdicts.set(verdict.rideId, { ...verdict.snapshot(), version: prev ? prev.version + 1 : 1 });
  }

  async findByRide(rideId: string): Promise<RideVerdict | null> {
    const v = this.db.verdicts.get(rideId);
    return v ? RideVerdict.restore(v) : null;
  }
}

@Injectable()
export class MemoryRideReplayRepository extends RideReplayRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async save(replay: RideReplay): Promise<RideReplay> {
    const snap = replay.snapshot();
    this.db.replays.set(replay.id, snap);
    return RideReplay.restore(snap);
  }

  async findById(id: string): Promise<RideReplay | null> {
    const r = this.db.replays.get(id);
    return r ? RideReplay.restore(r) : null;
  }

  async listByRide(rideId: string): Promise<RideReplay[]> {
    return [...this.db.replays.values()]
      .filter((r) => r.rideId === rideId)
      .sort((a, b) => b.seq - a.seq || b.queuedAt.getTime() - a.queuedAt.getTime())
      .map((r) => RideReplay.restore(r));
  }

  async findLatestByRide(rideId: string): Promise<RideReplay | null> {
    return (await this.listByRide(rideId))[0] ?? null;
  }

  async listPending(limit: number): Promise<RideReplay[]> {
    return [...this.db.replays.values()]
      .filter((r) => r.status === VerdictStatus.Pending)
      .sort((a, b) => Number(b.isPaid) - Number(a.isPaid) || a.queuedAt.getTime() - b.queuedAt.getTime())
      .slice(0, limit)
      .map((r) => RideReplay.restore(r));
  }

  async listRecent(filter: { status?: string; isPaid?: boolean; limit: number }): Promise<RideReplay[]> {
    return [...this.db.replays.values()]
      .filter((r) => (!filter.status || r.status === filter.status) && (filter.isPaid === undefined || r.isPaid === filter.isPaid))
      .sort((a, b) => b.queuedAt.getTime() - a.queuedAt.getTime() || b.seq - a.seq)
      .slice(0, filter.limit)
      .map((r) => RideReplay.restore(r));
  }

  async nextSeq(rideId: string): Promise<number> {
    const existing = [...this.db.replays.values()].filter((r) => r.rideId === rideId);
    return existing.length ? Math.max(...existing.map((r) => r.seq)) + 1 : 1;
  }
}

@Injectable()
export class MemoryAchievementRepository extends AchievementRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async insertAll(unlocks: readonly AchievementUnlock[]): Promise<readonly string[]> {
    const added: string[] = [];
    for (const unlock of unlocks) {
      if (this.db.unlocks.some((u) => u.wallet === unlock.wallet && u.achievementId === unlock.achievementId)) continue;
      this.db.unlocks.push(unlock);
      added.push(unlock.achievementId);
    }
    return added;
  }

  async listByWallet(wallet: string): Promise<AchievementUnlock[]> { return this.db.unlocks.filter((u) => u.wallet === wallet).map((u) => new AchievementUnlock(u.wallet, u.achievementId, u.earnedAt, u.rideId)); }
}

@Injectable()
export class MemoryAchievementMintRepository extends AchievementMintRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  private row(wallet: string, achievementId: string) { return this.db.mints.find((m) => m.wallet === wallet && m.achievementId === achievementId); }

  async listUnqueued(before: Date, ids: readonly string[], limit: number): Promise<AchievementUnlock[]> {
    return this.db.unlocks.filter((u) => u.earnedAt <= before && ids.includes(u.achievementId) && !this.row(u.wallet, u.achievementId))
      .sort((a, b) => a.earnedAt.getTime() - b.earnedAt.getTime() || a.wallet.localeCompare(b.wallet) || a.achievementId.localeCompare(b.achievementId)).slice(0, limit);
  }

  async enqueue(rows: readonly { wallet: string; achievementId: string; skip: string | null }[]): Promise<number> {
    let n = 0;
    for (const r of rows) {
      if (this.row(r.wallet, r.achievementId)) continue;
      this.db.mints.push({ wallet: r.wallet, achievementId: r.achievementId, status: r.skip ? 'skipped' : 'planned', signature: null, lastValidBlockHeight: null, assetId: null, attempts: 0, error: r.skip });
      n += 1;
    }
    return n;
  }

  async listWork(limit: number): Promise<AchievementMintRecord[]> { return this.db.mints.filter((m) => m.status === 'planned' || m.status === 'sent').slice(0, limit).map((m) => ({ ...m })); }
  async listByWallet(wallet: string): Promise<AchievementMintRecord[]> { return this.db.mints.filter((m) => m.wallet === wallet).map((m) => ({ ...m })); }

  async claimSent(wallet: string, achievementId: string, signature: string, lastValidBlockHeight: number): Promise<boolean> {
    const m = this.row(wallet, achievementId);
    if (!m || m.status !== 'planned') return false;
    Object.assign(m, { status: 'sent', signature, lastValidBlockHeight, attempts: m.attempts + 1 });
    return true;
  }

  async markMinted(wallet: string, achievementId: string, signature: string, assetId: string): Promise<boolean> {
    const m = this.row(wallet, achievementId);
    if (!m || m.status !== 'sent' || m.signature !== signature) return false;
    Object.assign(m, { status: 'minted', assetId, error: null });
    return true;
  }

  async release(wallet: string, achievementId: string, signature: string, error: string): Promise<boolean> {
    const m = this.row(wallet, achievementId);
    if (!m || m.status !== 'sent' || m.signature !== signature) return false;
    Object.assign(m, { status: m.attempts >= MAX_MINT_ATTEMPTS ? 'failed' : 'planned', signature: null, lastValidBlockHeight: null, error });
    return true;
  }

  async markSkipped(wallet: string, achievementId: string, reason: string): Promise<boolean> {
    const m = this.row(wallet, achievementId);
    if (!m || m.status !== 'planned') return false;
    Object.assign(m, { status: 'skipped', error: reason });
    return true;
  }

  async noteError(wallet: string, achievementId: string, error: string): Promise<void> { const m = this.row(wallet, achievementId); if (m?.status === 'planned') m.error = error; }

  async retryFailed(): Promise<number> {
    const failed = this.db.mints.filter((m) => m.status === 'failed');
    for (const m of failed) Object.assign(m, { status: 'planned', attempts: 0 });
    return failed.length;
  }
}

export { MemoryChainCursorRepository, MemoryChainEventRepository } from './memory-chain-repositories.js';
@Injectable()
export class MemorySignInRepository extends SignInRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async insert(record: SignInRecord): Promise<void> { this.db.signIns.push({ ...record }); }

  async recent(limit: number, wallet?: string): Promise<SignInRecord[]> {
    return [...this.db.signIns].reverse().filter((s) => !wallet || s.wallet === wallet).slice(0, limit); // insertion order = time order here
  }

  async countSince(at: Date): Promise<number> { return this.db.signIns.filter((s) => s.at.getTime() >= at.getTime()).length; }

  async summaryOf(wallets: readonly string[]): Promise<SignInSummary[]> {
    return [...new Set(wallets)].sort().flatMap((wallet) => {
      const mine = this.db.signIns.filter((s) => s.wallet === wallet);
      return mine.length ? [{ wallet, firstAt: new Date(Math.min(...mine.map((s) => s.at.getTime()))), ips: [...new Set(mine.flatMap((s) => (s.ip ? [s.ip] : [])))].sort() }] : [];
    });
  }

  async deleteBefore(cutoff: Date): Promise<number> {
    const keep = this.db.signIns.filter((s) => s.at.getTime() >= cutoff.getTime());
    const deleted = this.db.signIns.length - keep.length;
    this.db.signIns = keep;
    return deleted;
  }
}

@Injectable()
export class MemoryAdminActionRepository extends AdminActionRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async insert(record: AdminActionRecord): Promise<void> { this.db.adminActions.push({ ...record }); }
  async recent(limit: number): Promise<AdminActionRecord[]> { return [...this.db.adminActions].reverse().slice(0, limit); }
}

@Injectable()
export class MemoryAdminQuery extends AdminQueryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async counts(): Promise<AdminCounts> {
    const tally = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
    const rides = tally([...this.db.rides.values()].map((r) => r.props.status));
    return {
      players: this.db.players.size, running: rides['running'] ?? 0, rides, verdicts: tally([...this.db.verdicts.values()].map((v) => v.status)), underReview: (await this.rides({ review: 'under_review', limit: Number.MAX_SAFE_INTEGER })).length,
      payments: { count: this.db.payments.length, lamports: this.db.payments.reduce((sum, p) => sum + p.lamports, 0) },
      telemetry: { batches: this.db.batches.size, bytes: [...this.db.batches.values()].reduce((sum, b) => sum + b.bytes, 0) },
    };
  }

  async queueCount(): Promise<number> { return (await this.rides({ review: 'under_review', limit: Number.MAX_SAFE_INTEGER })).length; }
  async flaggedCount(): Promise<number> { return [...this.db.verdicts.values()].filter((v) => v.status === 'flagged').length; }

  async rides(filter: AdminRideFilter): Promise<AdminRideRow[]> {
    const rows = [...this.db.rides.values()]
      .filter(({ props: p }) => (!filter.wallet || p.wallet === filter.wallet) && (!filter.status || p.status === filter.status) && (filter.poolId === undefined || p.poolId === filter.poolId)
        && (!filter.verdict || (filter.verdict === 'none' ? !this.db.verdicts.has(p.id) : this.db.verdicts.get(p.id)?.status === filter.verdict)))
      .sort((a, b) => b.props.createdAt.getTime() - a.props.createdAt.getTime() || b.seq - a.seq)
      .map(({ props: p }) => {
        const v = this.db.verdicts.get(p.id);
        return { id: p.id, wallet: p.wallet, tier: p.tier, status: p.status, reason: p.reason, route: p.route, lastS: p.lastS, driveSeconds: p.driveSeconds, timeScale: p.timeScale,
          createdAt: p.createdAt, startedAt: p.startedAt, endedAt: p.endedAt, verdict: v?.status ?? null, overridden: (v?.overriddenBy ?? null) !== null, poolId: p.poolId };
      });
    if (filter.review !== 'under_review') return rows.slice(0, filter.limit);
    const paid = rows.filter((r) => r.tier !== 'free' && r.status === 'completed' && (r.verdict === null || (!r.overridden && r.verdict !== 'verified')));
    return [...paid, ...rows.filter((r) => r.tier === 'free' && r.verdict === 'flagged')].slice(0, filter.limit);
  }

  async poolRides(poolId: number): Promise<PoolRideFacts[]> {
    return [...this.db.rides.values()].filter(({ props: p }) => p.poolId === poolId && p.status === RideStatus.Completed && inWindow(this.db, p))
      .sort((a, b) => (a.props.endedAt?.getTime() ?? 0) - (b.props.endedAt?.getTime() ?? 0) || a.seq - b.seq)
      .map(({ props: p }) => {
        const v = this.db.verdicts.get(p.id);
        return { rideId: p.id, wallet: p.wallet, distance: p.lastS, driveSeconds: p.driveSeconds, startedAt: p.startedAt, endedAt: p.endedAt, verdict: v?.status ?? null, overridden: (v?.overriddenBy ?? null) !== null };
      });
  }

  async batchIndex(rideId: string): Promise<AdminBatchDto[]> {
    return [...this.db.batches.values()].filter((b) => b.rideId === rideId).sort((a, b) => a.seq - b.seq)
      .map((b) => ({ seq: b.seq, t0: b.t0, t1: b.t1, samples: b.samples, inputs: b.inputs, bytes: b.bytes, hashOk: b.hashOk, receivedAt: b.receivedAt.getTime() }));
  }
}
