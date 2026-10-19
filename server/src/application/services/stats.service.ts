import { Injectable } from '@nestjs/common';
import type { RideProps } from '../../domain/rides/ride.entity.js';
import { DAILY_WINDOW_DAYS, EMPTY_STATS as EMPTY, donationDelta, rideDelta, toStatsDto, type DailyStatsDto, type GlobalStatsDto, type StatsDto } from '../../domain/stats/stats.js';
import { StatsRepositoryPort } from '../ports/stats/stats.repository.port.js';
import { CachePort } from '../ports/shared/cache.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import type { TransactionHandle } from '../ports/shared/transaction.port.js';

/** how long a cached read lives – writes drop the keys too, so this only bounds a write that raced a read */
export const STATS_CACHE_TTL_SECONDS = 15;
export const GLOBAL_STATS_KEY = 'stats:global';
export const DAILY_STATS_KEY = 'stats:daily';
export const playerStatsKey = (wallet: string): string => `stats:player:${wallet}`;

/**
 * The core metrics (docs/spec/platform_services.md). WRITES: `recordRide` runs inside the transaction that saves the ended ride (every path that ends a ride calls it –
 * `test/architecture/stats-hooks.spec.ts` fails when one forgets), `recordDonation` when a donation lands on a stream; both add to the driver's row FIRST and to
 * the global row second, as atomic increments. READS are cached (Redis in production): `global()` for the landing / `GET /api/stats`, `player()` for the profile.
 * After a write commits the caller calls `invalidate(wallet)`; a cache that fails is a miss, so the database is always the answer.
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly repo: StatsRepositoryPort,
    private readonly cache: CachePort,
    private readonly clock: ClockPort,
  ) {}

  /** A ride that just ended (any path). Returns whether it counted – a ride that never started does not. Call `invalidate` after the transaction commits. */
  async recordRide(ride: RideProps, tx?: TransactionHandle): Promise<boolean> {
    const delta = rideDelta(ride);
    if (!delta) return false;
    const now = this.clock.now();
    await this.repo.add(ride.wallet, delta, now, tx, ride.endedAt ?? now);   // the history files it under the UTC day the ride ENDED
    return true;
  }

  /** A donation that landed on `driver`'s stream; `paid` = a real transfer (its lamports count), otherwise a mock tip (counted, no lamports). */
  async recordDonation(driver: string, lamports: number, paid: boolean, at?: Date): Promise<void> {
    const now = this.clock.now();
    await this.repo.add(driver, donationDelta(lamports, paid), now, undefined, at ?? now);   // `at` = when the donation event was created (its day in the history)
    await this.invalidate(driver);
  }

  async invalidate(...wallets: string[]): Promise<void> {
    await this.cache.del(GLOBAL_STATS_KEY, DAILY_STATS_KEY, ...wallets.map(playerStatsKey));
  }

  async global(): Promise<GlobalStatsDto> {
    const hit = await this.cache.get<GlobalStatsDto>(GLOBAL_STATS_KEY);
    if (hit) return hit;
    const [row, drivers] = await Promise.all([this.repo.findGlobal(), this.repo.countDrivers()]);
    const dto: GlobalStatsDto = { ...toStatsDto(row?.totals ?? EMPTY), drivers, updatedAt: row?.updatedAt.getTime() ?? 0 };
    await this.cache.set(GLOBAL_STATS_KEY, dto, STATS_CACHE_TTL_SECONDS);
    return dto;
  }

  async player(wallet: string): Promise<StatsDto> {
    const key = playerStatsKey(wallet);
    const hit = await this.cache.get<StatsDto>(key);
    if (hit) return hit;
    const dto = toStatsDto((await this.repo.findPlayer(wallet))?.totals ?? EMPTY);
    await this.cache.set(key, dto, STATS_CACHE_TTL_SECONDS);
    return dto;
  }

  /** The history: one row per UTC day that has any, oldest first, the newest DAILY_WINDOW_DAYS days. */
  async daily(): Promise<DailyStatsDto[]> {
    const hit = await this.cache.get<DailyStatsDto[]>(DAILY_STATS_KEY);
    if (hit) return hit;
    const rows = await this.repo.listDaily(DAILY_WINDOW_DAYS, this.clock.now());
    await this.cache.set(DAILY_STATS_KEY, rows, STATS_CACHE_TTL_SECONDS);
    return rows;
  }
}
