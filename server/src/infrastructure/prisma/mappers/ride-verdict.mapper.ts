import type { Prisma, RideVerdict as RideVerdictRow, VerdictStatus as VerdictStatusRow } from '@prisma/client';
import { RideVerdict, type VerdictScores } from '../../../domain/verdict/ride-verdict.entity.js';
import type { VerdictReason, VerdictStatus } from '../../../domain/verdict/verdict.dto.js';

export class RideVerdictMapper {
  static toDomain(row: RideVerdictRow): RideVerdict {
    return RideVerdict.restore({
      rideId: row.rideId, status: row.status as unknown as VerdictStatus, reasons: row.reasons as unknown as VerdictReason[], scores: row.scores as unknown as VerdictScores,
      rulesVersion: row.rulesVersion, judgedAt: row.judgedAt, version: row.version,
    });
  }

  /** the columns a (re-)judgement writes */
  static data(verdict: RideVerdict) {
    const p = verdict.snapshot();
    return {
      status: p.status as unknown as VerdictStatusRow, reasons: p.reasons as unknown as Prisma.InputJsonValue, scores: p.scores as unknown as Prisma.InputJsonValue,
      rulesVersion: p.rulesVersion, judgedAt: p.judgedAt,
    };
  }
}
