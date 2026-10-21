import type { TransactionHandle } from '../ports/shared/transaction.port.js';

/** One `stats.RideResult` row. Lane 1 adds the table; this port no-ops when it is not there yet. */
export interface RideResultRow {
  rideId: string;
  poolId: number | null;
  wallet: string;
  finishRulesVersion: number | null;
  scoreFormulaVersion: number;
  durationMs: number;
  effectiveDurationMs: number;
  damageTotal: number;
  damageHoles: number;
  damageVehicles: number;
  damageProps: number;
  damageCold: number;
  damageOther: number;
  redLights: number;
  offRoadSeconds: number;
  mgTotal: number;
  mgPassed: number;
  mgWrong: number;
  mgMissed: number;
  mgPenaltySeconds: number;
  humannessScore: number | null;
  compositeScore: number | null;
  finished: boolean;
  finishedAt: Date | null;
  distanceM: number;
  verdictTier: string | null;
  createdAt: Date;
}

export abstract class RideResultRepositoryPort {
  /** Insert or replace the row for this ride. Returns false when `stats.RideResult` does not exist yet. */
  abstract upsert(row: RideResultRow, tx?: TransactionHandle): Promise<boolean>;
  abstract listByPool(poolId: number): Promise<RideResultRow[]>;
  abstract findByRide(rideId: string): Promise<RideResultRow | null>;
}
