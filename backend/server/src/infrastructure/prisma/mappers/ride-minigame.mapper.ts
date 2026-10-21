import { Prisma, type RideMiniGame as RideMiniGameRow } from '@prisma/client';
import type { MiniGameStatus } from '../../../domain/minigames/close.js';
import { RideMiniGame, type MiniGameDetail, type RideMiniGameProps } from '../../../domain/minigames/ride-minigame.js';

function detailOf(value: Prisma.JsonValue | null): MiniGameDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as MiniGameDetail;
}

export class RideMiniGameMapper {
  static toDomain(row: RideMiniGameRow): RideMiniGame {
    return RideMiniGame.restore({
      id: row.id, rideId: row.rideId, ordinal: row.ordinal, kind: row.kind, status: row.status as MiniGameStatus, variantSeq: row.variantSeq,
      trigger: row.trigger, armedAtMs: row.armedAtMs, bayDeadlineMs: row.bayDeadlineMs, slotS: row.slotS, windowMs: row.windowMs,
      revealedAt: row.revealedAt, answeredAt: row.answeredAt, attempts: row.attempts, outcome: row.outcome, penaltyS: row.penaltyS,
      answerHash: row.answerHash, clientSafe: row.clientSafe, nonce: row.nonce, mgDetail: detailOf(row.mgDetail), rulesVersion: row.rulesVersion,
    });
  }

  static toCreate(row: RideMiniGame): Prisma.RideMiniGameUncheckedCreateInput {
    return RideMiniGameMapper.mutable(row.snapshot());
  }

  static toUpdate(row: RideMiniGame): Prisma.RideMiniGameUncheckedUpdateInput {
    const p = RideMiniGameMapper.mutable(row.snapshot());
    const { id: _id, rideId: _rideId, ordinal: _ordinal, ...rest } = p;
    return rest;
  }

  private static mutable(p: RideMiniGameProps): Prisma.RideMiniGameUncheckedCreateInput {
    return {
      id: p.id, rideId: p.rideId, ordinal: p.ordinal, kind: p.kind, status: p.status, variantSeq: p.variantSeq, trigger: p.trigger,
      armedAtMs: p.armedAtMs, bayDeadlineMs: p.bayDeadlineMs, slotS: p.slotS, windowMs: p.windowMs, revealedAt: p.revealedAt, answeredAt: p.answeredAt,
      attempts: p.attempts, outcome: p.outcome, penaltyS: p.penaltyS, answerHash: p.answerHash, clientSafe: p.clientSafe, nonce: p.nonce,
      mgDetail: p.mgDetail ? (p.mgDetail as unknown as Prisma.InputJsonValue) : Prisma.DbNull, rulesVersion: p.rulesVersion,
    };
  }
}
