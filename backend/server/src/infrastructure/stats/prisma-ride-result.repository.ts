import { Injectable } from '@nestjs/common';
import { RideResultRepositoryPort, type RideResultRow } from '../../application/rides/ride-result.port.js';
import type { TransactionHandle } from '../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma/prisma-client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/* stats.RideResult is created by Lane 1. Until that migration is on this database the port reports the table missing and does not write. */

interface ResultSql {
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
  computedAt: Date | null;
  distanceM: number;
  verdictTier: string | null;
  createdAt: Date;
}

const COLS = `
  "rideId", "poolId", "wallet", "finishRulesVersion", "scoreFormulaVersion", "durationMs", "effectiveDurationMs",
  "damageTotal", "damageHoles", "damageVehicles", "damageProps", "damageCold", "damageOther", "redLights", "offRoadSeconds",
  "mgTotal", "mgPassed", "mgWrong", "mgMissed", "mgPenaltySeconds", "humannessScore", "compositeScore",
  "finished", "computedAt", "distanceM", "verdictTier", "createdAt"`;

@Injectable()
export class PrismaRideResultRepository extends RideResultRepositoryPort {
  private tableReady = false;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async upsert(row: RideResultRow, tx?: TransactionHandle): Promise<boolean> {
    const db = clientFor(this.prisma, tx);
    if (!(await this.present(db))) return false;
    await db.$executeRaw`
      INSERT INTO stats."RideResult" (
        "rideId", "poolId", "wallet", "finishRulesVersion", "scoreFormulaVersion", "durationMs", "effectiveDurationMs",
        "damageTotal", "damageHoles", "damageVehicles", "damageProps", "damageCold", "damageOther", "redLights", "offRoadSeconds",
        "mgTotal", "mgPassed", "mgWrong", "mgMissed", "mgPenaltySeconds", "humannessScore", "compositeScore",
        "finished", "computedAt", "distanceM", "verdictTier", "createdAt"
      ) VALUES (
        ${row.rideId}, ${row.poolId}, ${row.wallet}, ${row.finishRulesVersion}, ${row.scoreFormulaVersion},
        ${Math.round(row.durationMs)}, ${Math.round(row.effectiveDurationMs)}, ${row.damageTotal}, ${row.damageHoles}, ${row.damageVehicles},
        ${row.damageProps}, ${row.damageCold}, ${row.damageOther}, ${Math.round(row.redLights)}, ${row.offRoadSeconds},
        ${row.mgTotal}, ${row.mgPassed}, ${row.mgWrong}, ${row.mgMissed}, ${row.mgPenaltySeconds},
        ${row.humannessScore}, ${row.compositeScore}, ${row.finished}, ${row.finishedAt}, ${row.distanceM}, ${row.verdictTier}, ${row.createdAt}
      )
      ON CONFLICT ("rideId") DO UPDATE SET
        "poolId" = EXCLUDED."poolId", "wallet" = EXCLUDED."wallet", "finishRulesVersion" = EXCLUDED."finishRulesVersion",
        "scoreFormulaVersion" = EXCLUDED."scoreFormulaVersion", "durationMs" = EXCLUDED."durationMs",
        "effectiveDurationMs" = EXCLUDED."effectiveDurationMs", "damageTotal" = EXCLUDED."damageTotal",
        "damageHoles" = EXCLUDED."damageHoles", "damageVehicles" = EXCLUDED."damageVehicles", "damageProps" = EXCLUDED."damageProps",
        "damageCold" = EXCLUDED."damageCold", "damageOther" = EXCLUDED."damageOther", "redLights" = EXCLUDED."redLights",
        "offRoadSeconds" = EXCLUDED."offRoadSeconds", "mgTotal" = EXCLUDED."mgTotal", "mgPassed" = EXCLUDED."mgPassed",
        "mgWrong" = EXCLUDED."mgWrong", "mgMissed" = EXCLUDED."mgMissed", "mgPenaltySeconds" = EXCLUDED."mgPenaltySeconds",
        "humannessScore" = EXCLUDED."humannessScore", "compositeScore" = EXCLUDED."compositeScore",
        "finished" = EXCLUDED."finished", "computedAt" = EXCLUDED."computedAt", "distanceM" = EXCLUDED."distanceM",
        "verdictTier" = EXCLUDED."verdictTier"`;
    return true;
  }

  async listByPool(poolId: number): Promise<RideResultRow[]> {
    const db = clientFor(this.prisma);
    if (!(await this.present(db))) return [];
    const rows = await db.$queryRawUnsafe<ResultSql[]>(`SELECT ${COLS} FROM stats."RideResult" WHERE "poolId" = $1 ORDER BY "createdAt" ASC`, poolId);
    return rows.map(toRow);
  }

  async findByRide(rideId: string): Promise<RideResultRow | null> {
    const db = clientFor(this.prisma);
    if (!(await this.present(db))) return null;
    const found = await db.$queryRawUnsafe<ResultSql[]>(`SELECT ${COLS} FROM stats."RideResult" WHERE "rideId" = $1`, rideId);
    return found[0] ? toRow(found[0]) : null;
  }

  private async present(db: ReturnType<typeof clientFor>): Promise<boolean> {
    if (this.tableReady) return true;
    const rows = await db.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = 'stats' AND table_name = 'RideResult'`;
    if (!rows.length) return false;
    this.tableReady = true;
    return true;
  }
}

function toRow(row: ResultSql): RideResultRow {
  return {
    ...row,
    poolId: row.poolId === null ? null : Number(row.poolId),
    finishRulesVersion: row.finishRulesVersion === null ? null : Number(row.finishRulesVersion),
    scoreFormulaVersion: Number(row.scoreFormulaVersion),
    durationMs: Number(row.durationMs),
    effectiveDurationMs: Number(row.effectiveDurationMs),
    damageTotal: Number(row.damageTotal),
    damageHoles: Number(row.damageHoles),
    damageVehicles: Number(row.damageVehicles),
    damageProps: Number(row.damageProps),
    damageCold: Number(row.damageCold),
    damageOther: Number(row.damageOther),
    redLights: Number(row.redLights),
    offRoadSeconds: Number(row.offRoadSeconds),
    mgTotal: Number(row.mgTotal),
    mgPassed: Number(row.mgPassed),
    mgWrong: Number(row.mgWrong),
    mgMissed: Number(row.mgMissed),
    mgPenaltySeconds: Number(row.mgPenaltySeconds),
    humannessScore: row.humannessScore === null ? null : Number(row.humannessScore),
    compositeScore: row.compositeScore === null ? null : Number(row.compositeScore),
    distanceM: Number(row.distanceM),
    finishedAt: row.computedAt ? new Date(row.computedAt) : null,
    createdAt: new Date(row.createdAt),
  };
}
