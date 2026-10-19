import { StatsRepositoryPort, type StatsRow } from '../../../src/application/ports/stats/stats.repository.port.js';
import type { TransactionHandle } from '../../../src/application/ports/shared/transaction.port.js';
import { EMPTY_STATS, addStats, countsForStats, toStatsDto, utcDay, type DailyStatsDto, type StatsTotals } from '../../../src/domain/stats/stats.js';
import { RideStatus } from '../../../src/domain/rides/ride-status.js';
import type { MemoryDb } from './memory-db.js';

/** The statistics tables on plain maps: the same increments, the same recompute rule as the PostgreSQL repository. */
export class MemoryStatsRepository extends StatsRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async add(wallet: string, delta: StatsTotals, now: Date, _tx?: TransactionHandle, at: Date = now): Promise<void> {
    this.db.playerStats.set(wallet, { totals: addStats(this.db.playerStats.get(wallet)?.totals ?? EMPTY_STATS, delta), updatedAt: now });
    this.db.globalStats = { totals: addStats(this.db.globalStats?.totals ?? EMPTY_STATS, delta), updatedAt: now };
    const day = utcDay(at);
    this.db.dailyStats.set(day, addStats(this.db.dailyStats.get(day) ?? EMPTY_STATS, delta));
  }

  async findPlayer(wallet: string): Promise<StatsRow | null> { return this.db.playerStats.get(wallet) ?? null; }
  async findGlobal(): Promise<StatsRow | null> { return this.db.globalStats; }
  async countDrivers(): Promise<number> { return [...this.db.playerStats.values()].filter((r) => r.totals.rides > 0).length; }

  async listPlayers(wallet?: string): Promise<Map<string, StatsTotals>> {
    return new Map([...this.db.playerStats].filter(([w]) => !wallet || w === wallet).map(([w, r]) => [w, r.totals]));
  }

  async recompute(wallet?: string): Promise<Map<string, StatsTotals>> {
    const out = new Map<string, StatsTotals>();
    for (const { props: r } of this.db.rides.values()) {
      if ((wallet && r.wallet !== wallet) || !countsForStats(r)) continue;
      out.set(r.wallet, addStats(out.get(r.wallet) ?? EMPTY_STATS, {
        ...EMPTY_STATS, rides: 1, ridesFree: r.tier === 'free' ? 1 : 0, ridesPaid: r.tier === 'free' ? 0 : 1, ridesCompleted: r.status === RideStatus.Completed ? 1 : 0, seconds: r.driveSeconds, metres: r.lastS, crashesVehicle: r.crashesVehicle, crashesBuilding: r.crashesBuilding,
      }));
    }
    for (const e of this.db.rideEvents) {
      if (e.kind !== 'donation') continue;
      const owner = this.db.rides.get(e.rideId)?.props.wallet;
      if (!owner || (wallet && owner !== wallet)) continue;
      out.set(owner, addStats(out.get(owner) ?? EMPTY_STATS, { ...EMPTY_STATS, donations: 1, donationLamports: e.signature ? e.lamports : 0 }));
    }
    return out;
  }

  async replace(truth: Map<string, StatsTotals>, now: Date, scope: string | null, daily?: Map<string, StatsTotals>): Promise<void> {
    for (const [w, totals] of truth) this.db.playerStats.set(w, { totals, updatedAt: now });
    for (const w of this.db.playerStats.keys()) if (!truth.has(w) && (!scope || w === scope)) this.db.playerStats.delete(w);
    this.db.globalStats = { totals: [...this.db.playerStats.values()].reduce<StatsTotals>((s, r) => addStats(s, r.totals), EMPTY_STATS), updatedAt: now };
    if (daily) this.db.dailyStats = new Map(daily);
  }

  async listDaily(days: number, until: Date): Promise<DailyStatsDto[]> {
    const from = utcDay(new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate() - (days - 1))));
    return [...this.db.dailyStats].filter(([d]) => d >= from).sort(([a], [b]) => a.localeCompare(b)).map(([day, t]) => ({ day, ...toStatsDto(t) }));
  }

  async listAllDaily(): Promise<Map<string, StatsTotals>> { return new Map(this.db.dailyStats); }

  async recomputeDaily(): Promise<Map<string, StatsTotals>> {
    const out = new Map<string, StatsTotals>();
    const bump = (day: string, t: StatsTotals) => out.set(day, addStats(out.get(day) ?? EMPTY_STATS, t));
    for (const { props: r } of this.db.rides.values()) {
      if (!countsForStats(r) || !r.endedAt) continue;
      bump(utcDay(r.endedAt), { ...EMPTY_STATS, rides: 1, ridesFree: r.tier === 'free' ? 1 : 0, ridesPaid: r.tier === 'free' ? 0 : 1, ridesCompleted: r.status === RideStatus.Completed ? 1 : 0, seconds: r.driveSeconds, metres: r.lastS, crashesVehicle: r.crashesVehicle, crashesBuilding: r.crashesBuilding });
    }
    for (const e of this.db.rideEvents) if (e.kind === 'donation') bump(utcDay(e.createdAt), { ...EMPTY_STATS, donations: 1, donationLamports: e.signature ? e.lamports : 0 });
    return out;
  }
}
