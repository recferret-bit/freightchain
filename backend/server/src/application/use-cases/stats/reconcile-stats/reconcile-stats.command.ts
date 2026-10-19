import type { StatsField } from '../../../../domain/stats/stats.js';

/** Compare the stored statistics with what the rides and the feed say (`wallet` = just that rider, else everyone); `fix` rewrites the rows. */
export class ReconcileStatsCommand {
  constructor(public readonly wallet: string | null = null, public readonly fix = false) {}
}

export interface StatsDriftDto {
  wallet: string;
  /** a field → what the table holds vs what the rides say */
  fields: Partial<Record<StatsField, { stored: number; truth: number }>>;
}

export interface ReconcileStatsResultDto {
  checked: number;
  /** riders whose row differs (or is missing / has no rides behind it) */
  drifted: StatsDriftDto[];
  /** the game-wide row vs the sum of every rider's true totals (everyone-scope only; null when a single wallet was checked) */
  global: StatsDriftDto['fields'] | null;
  /** the UTC days of the history whose row differs from the rides / feed (everyone-scope only; empty when a single wallet was checked) */
  days: Array<{ day: string; fields: StatsDriftDto['fields'] }>;
  fixed: boolean;
}
