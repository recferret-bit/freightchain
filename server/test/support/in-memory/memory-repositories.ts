import { Injectable } from '@nestjs/common';
import { AchievementUnlock } from '../../../src/domain/achievements/achievement-unlock.entity.js';
import type { AuthChallenge } from '../../../src/domain/auth/auth-challenge.entity.js';
import type { LeaderboardBoard } from '../../../src/domain/economy/economy.dto.js';
import type { Payment } from '../../../src/domain/economy/payment.entity.js';
import { Round, type RoundProps } from '../../../src/domain/economy/round.entity.js';
import { Player } from '../../../src/domain/players/player.entity.js';
import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { OPEN_RIDE_STATUSES, RideStatus } from '../../../src/domain/rides/ride-status.js';
import { ConflictError, VersionConflictError } from '../../../src/domain/shared/errors.js';
import { AchievementRepositoryPort } from '../../../src/application/ports/achievements/achievement.repository.port.js';
import { ChallengeRepositoryPort } from '../../../src/application/ports/auth/challenge.repository.port.js';
import { PaymentRepositoryPort } from '../../../src/application/ports/economy/payment.repository.port.js';
import { RoundRepositoryPort, type RoundEntries } from '../../../src/application/ports/economy/round.repository.port.js';
import { HealthProbePort } from '../../../src/application/ports/health/health-probe.port.js';
import { PlayerRepositoryPort } from '../../../src/application/ports/players/player.repository.port.js';
import { RideQueryPort, type FinishedRideRow, type LeaderboardRow, type LiveRideRow, type RecentRideRow, type RideSummary, type RideTotalsRow, type UpcomingRideRow } from '../../../src/application/ports/rides/ride-query.port.js';
import { RideRepositoryPort } from '../../../src/application/ports/rides/ride.repository.port.js';
import { TransactionPort } from '../../../src/application/ports/shared/transaction.port.js';
import { RideBatchRepositoryPort } from '../../../src/application/ports/telemetry/ride-batch.repository.port.js';
import { RideBatch } from '../../../src/domain/telemetry/ride-batch.entity.js';
import { RideVerdictRepositoryPort } from '../../../src/application/ports/verdict/ride-verdict.repository.port.js';
import { RideVerdict } from '../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../src/domain/verdict/verdict.dto.js';
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

  async insertIfAbsent(player: Player): Promise<void> {
    if (!this.db.players.has(player.wallet)) this.db.players.set(player.wallet, player.snapshot());
  }

  async grantDailyFreeRides(today: string): Promise<number> {
    let touched = 0;
    for (const [wallet, p] of this.db.players) {
      if (p.freeDay >= today) continue;
      this.db.players.set(wallet, { ...p, freeRides: p.freeRides < p.freeRidesMax ? p.freeRides + 1 : p.freeRides, freeDay: today, version: p.version + 1 });
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

  async consume(wallet: string): Promise<AuthChallenge | null> {
    const c = this.db.challenges.get(wallet) ?? null;
    this.db.challenges.delete(wallet);
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
}

@Injectable()
export class MemoryRideQuery extends RideQueryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  private of(wallet: string) { return [...this.db.rides.values()].filter((r) => r.props.wallet === wallet); }

  async live(heartbeatSince: Date, limit: number): Promise<LiveRideRow[]> {
    return [...this.db.rides.values()]
      .filter((r) => r.props.status === RideStatus.Running && r.props.lastHbAt && r.props.lastHbAt >= heartbeatSince)
      .sort((a, b) => (b.props.startedAt?.getTime() ?? 0) - (a.props.startedAt?.getTime() ?? 0) || b.seq - a.seq)
      .slice(0, limit)
      .flatMap(({ props: p }) => (p.startedAt && p.lastHbAt
        ? [{ wallet: p.wallet, tier: p.tier, route: p.route, minSeconds: p.minSeconds, completeDist: p.completeDist, driveSeconds: p.driveSeconds, lastS: p.lastS, hull: p.hull, paused: p.paused, timeScale: p.timeScale, startedAt: p.startedAt, lastHbAt: p.lastHbAt }]
        : []));
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
      .map(({ props: p }) => ({ wallet: p.wallet, tier: p.tier, route: p.route, status: p.status, lastS: p.lastS, endedAt: p.endedAt }));
  }

  async totals(): Promise<RideTotalsRow> {
    const done = [...this.db.rides.values()].map((r) => r.props).filter((r) => r.status === RideStatus.Completed);
    return { shifts: done.length, metres: done.reduce((sum, r) => sum + r.lastS, 0), drivers: new Set(done.map((r) => r.wallet)).size };
  }

  async summary(wallet: string): Promise<RideSummary> {
    const rides = this.of(wallet).map((r) => r.props);
    const started = rides.filter((r) => r.startedAt);
    const done = rides.filter((r) => r.status === RideStatus.Completed);
    const metres = started.reduce((sum, r) => sum + r.lastS, 0);
    return {
      stats: { started: started.length, completed: done.length, metres, best: done.reduce((m, r) => Math.max(m, r.lastS), 0) },
      facts: {
        started: started.length, completed: done.length, totalMetres: metres,
        completedAtNight: done.some((r) => r.driveSeconds > 0 && r.nightSeconds >= 0.5 * r.driveSeconds),
        cleanRun: done.some((r) => r.hull !== null && r.hull >= 99.5),
        completedSiberia: done.some((r) => r.route === 'siberia'),
      },
    };
  }

  async recent(wallet: string, limit: number): Promise<RecentRideRow[]> {
    return this.of(wallet)
      .filter((r) => r.props.startedAt)
      .sort((a, b) => (b.props.startedAt?.getTime() ?? 0) - (a.props.startedAt?.getTime() ?? 0) || b.seq - a.seq)
      .slice(0, limit)
      .flatMap(({ props: p }) => (p.startedAt
        ? [{ tier: p.tier, status: p.status, lastS: p.lastS, hull: p.hull, route: p.route, timeScale: p.timeScale, startedAt: p.startedAt, endedAt: p.endedAt, verdict: this.db.verdicts.get(p.id)?.status ?? null }]
        : []));
  }

  async leaderboard(board: LeaderboardBoard, roundId: number | null, limit: number, verifiedOnly: boolean): Promise<LeaderboardRow[]> {
    const done = [...this.db.rides.values()].map((r) => r.props).filter((r) =>
      r.status === RideStatus.Completed && (board === 'free' ? r.tier === 'free'
        : r.tier !== 'free' && (!verifiedOnly || this.db.verdicts.get(r.id)?.status === VerdictStatus.Verified) && (board === 'round' ? r.roundId === roundId : true)));
    const groups = new Map<string, { distance: number; rides: number; first: number }>();
    for (const r of done) {
      const g = groups.get(r.wallet) ?? { distance: 0, rides: 0, first: Number.POSITIVE_INFINITY };
      g.distance += r.lastS; g.rides += 1; g.first = Math.min(g.first, r.endedAt?.getTime() ?? Number.POSITIVE_INFINITY);
      groups.set(r.wallet, g);
    }
    return [...groups.entries()]
      .sort(([wa, a], [wb, b]) => b.distance - a.distance || b.rides - a.rides || a.first - b.first || wa.localeCompare(wb))
      .slice(0, limit).map(([wallet, g]) => ({ wallet, distance: g.distance, rides: g.rides }));
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
      if (!ride?.endedAt || ride.endedAt.getTime() >= cutoff.getTime() || this.db.verdicts.get(b.rideId)?.status === VerdictStatus.Flagged) continue;
      this.db.batches.delete(key);
      deleted++;
    }
    return deleted;
  }

  async listByRide(rideId: string): Promise<RideBatch[]> {
    return [...this.db.batches.values()].filter((b) => b.rideId === rideId).sort((a, b) => a.seq - b.seq).map((b) => RideBatch.restore(b));
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
export class MemoryAchievementRepository extends AchievementRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async insertAll(unlocks: readonly AchievementUnlock[]): Promise<number> {
    let added = 0;
    for (const unlock of unlocks) {
      if (this.db.unlocks.some((u) => u.wallet === unlock.wallet && u.achievementId === unlock.achievementId)) continue;
      this.db.unlocks.push(unlock);
      added++;
    }
    return added;
  }

  async listByWallet(wallet: string): Promise<AchievementUnlock[]> { return this.db.unlocks.filter((u) => u.wallet === wallet).map((u) => new AchievementUnlock(u.wallet, u.achievementId, u.earnedAt, u.rideId)); }
}
