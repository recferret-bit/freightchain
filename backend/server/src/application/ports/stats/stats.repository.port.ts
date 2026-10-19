import type { DailyStatsDto, StatsTotals } from '../../../domain/stats/stats.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export interface StatsRow { totals: StatsTotals; updatedAt: Date }

export abstract class StatsRepositoryPort {
  /** Adds `delta` to the wallet's row (created on first use), THEN to the global row, THEN to the row of the UTC day of `at` (the event's own time) – atomic increments, never read-modify-write. */
  abstract add(wallet: string, delta: StatsTotals, now: Date, tx?: TransactionHandle, at?: Date): Promise<void>;
  abstract findPlayer(wallet: string): Promise<StatsRow | null>;
  /** the game's totals (null = the row does not exist yet) */
  abstract findGlobal(): Promise<StatsRow | null>;
  /** riders with at least one ended ride */
  abstract countDrivers(): Promise<number>;
  /** What the rides and the feed say the totals should be, per wallet – the ground truth `stats:reconcile` compares with (`wallet` set = just that one). */
  abstract recompute(wallet?: string): Promise<Map<string, StatsTotals>>;
  /** every stored per-rider row (`wallet` set = just that one) */
  abstract listPlayers(wallet?: string): Promise<Map<string, StatsTotals>>;
  /** Overwrites the rows with `truth`: a wallet in `truth` gets exactly it, a stored wallet missing from `truth` is zeroed; the global row becomes the sum of ALL riders. */
  abstract replace(truth: Map<string, StatsTotals>, now: Date, scope: string | null, daily?: Map<string, StatsTotals>): Promise<void>;
  /** the newest `days` days that have a row, oldest first */
  abstract listDaily(days: number, until: Date): Promise<DailyStatsDto[]>;
  /** every stored day (day → totals) – for the reconcile */
  abstract listAllDaily(): Promise<Map<string, StatsTotals>>;
  /** what the rides (by the day they ENDED) and the feed (by the day a donation landed) say each day's totals should be */
  abstract recomputeDaily(): Promise<Map<string, StatsTotals>>;
}
