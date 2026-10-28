import { Injectable } from '@nestjs/common';
import {
  EventSettlementRepositoryPort, type EventCandidateRow, type EventReviewRecord, type EventStateRecord, type EventWinnerRecord, type PayoutOutcome,
} from '../../../application/ports/prize/event-settlement.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { bestAttemptPerWallet, eventAttemptBps } from '../../../domain/prize/event-settlement.js';
import { PRESEASON_PROMO_CODE } from '../../../domain/settings/preseason-event.js';
import { clientFor, isUniqueViolation } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class EventSettlementPrismaRepository extends EventSettlementRepositoryPort {
  constructor(private readonly prisma: PrismaService) { super(); }

  async listCandidates(window: { start: Date; end: Date }, tx?: TransactionHandle): Promise<EventCandidateRow[]> {
    const rows = await clientFor(this.prisma, tx).ride.findMany({
      where: { promoCode: PRESEASON_PROMO_CODE, ranked: true, tier: '1h', status: 'completed', startedAt: { gte: window.start }, endedAt: { lte: window.end }, verdict: { is: { status: 'verified' } } },
      select: { id: true, wallet: true, cleanMetres: true, lastS: true, completeDist: true, endedAt: true, prizeCountry: true, prizeRegion: true, player: { select: { trustScore: true } } },
      orderBy: [{ endedAt: 'asc' }, { seq: 'asc' }],
    });
    return bestAttemptPerWallet(rows.map((r) => ({
      wallet: r.wallet, rideId: r.id, bps: eventAttemptBps(r.cleanMetres, r.lastS, r.completeDist), country: r.prizeCountry, region: r.prizeRegion, trustScore: r.player.trustScore, endedAt: r.endedAt as Date,
    })));
  }

  async reviews(eventId: string, tx?: TransactionHandle): Promise<EventReviewRecord[]> {
    return (await clientFor(this.prisma, tx).eventReview.findMany({ where: { eventId }, orderBy: { wallet: 'asc' } })).map(toReview);
  }

  async review(eventId: string, wallet: string, tx?: TransactionHandle): Promise<EventReviewRecord | null> {
    const row = await clientFor(this.prisma, tx).eventReview.findUnique({ where: { eventId_wallet: { eventId, wallet } } });
    return row ? toReview(row) : null;
  }

  async saveReview(eventId: string, r: EventReviewRecord, tx: TransactionHandle): Promise<void> {
    const data = { disqualified: r.disqualified, prizeEligibleOverride: r.prizeEligibleOverride, note: r.note, sanctionsCheckedAt: r.sanctionsCheckedAt, sanctionsClean: r.sanctionsClean, sanctionsRef: r.sanctionsRef, updatedBy: r.updatedBy, updatedAt: r.updatedAt };
    await clientFor(this.prisma, tx).eventReview.upsert({ where: { eventId_wallet: { eventId, wallet: r.wallet } }, create: { eventId, wallet: r.wallet, ...data }, update: data });
  }

  async state(eventId: string, tx?: TransactionHandle): Promise<EventStateRecord> {
    const row = await clientFor(this.prisma, tx).eventConfig.findUnique({ where: { eventId } });
    return { prizeTableCents: row && row.prizeTableCents.length > 0 ? row.prizeTableCents : null, lockedAt: row?.lockedAt ?? null, lockedBy: row?.lockedBy ?? null };
  }

  async setPrizeTable(eventId: string, cents: readonly number[], at: Date, tx: TransactionHandle): Promise<boolean> {
    const rows = await clientFor(this.prisma, tx).$queryRaw<{ eventId: string }[]>`
      INSERT INTO "economy"."EventConfig" ("eventId", "prizeTableCents", "updatedAt") VALUES (${eventId}, ${[...cents]}::int[], ${at})
      ON CONFLICT ("eventId") DO UPDATE SET "prizeTableCents" = EXCLUDED."prizeTableCents", "updatedAt" = EXCLUDED."updatedAt"
      WHERE "EventConfig"."lockedAt" IS NULL RETURNING "eventId"`;
    return rows.length === 1;
  }

  async lock(eventId: string, by: string, at: Date, winners: readonly EventWinnerRecord[], tx: TransactionHandle): Promise<boolean> {
    const db = clientFor(this.prisma, tx);
    const rows = await db.$queryRaw<{ eventId: string }[]>`
      INSERT INTO "economy"."EventConfig" ("eventId", "prizeTableCents", "lockedAt", "lockedBy", "updatedAt") VALUES (${eventId}, ARRAY[]::int[], ${at}, ${by}, ${at})
      ON CONFLICT ("eventId") DO UPDATE SET "lockedAt" = EXCLUDED."lockedAt", "lockedBy" = EXCLUDED."lockedBy", "updatedAt" = EXCLUDED."updatedAt"
      WHERE "EventConfig"."lockedAt" IS NULL RETURNING "eventId"`;
    if (rows.length === 0) return false;
    await db.eventWinner.createMany({ data: winners.map((w) => ({ eventId, wallet: w.wallet, place: w.place, amountCents: w.amountCents, bps: w.bps, rideId: w.rideId, lockedAt: w.lockedAt })) });
    return true;
  }

  async winners(eventId: string, tx?: TransactionHandle): Promise<EventWinnerRecord[]> {
    const rows = await clientFor(this.prisma, tx).eventWinner.findMany({ where: { eventId }, orderBy: [{ place: 'asc' }, { wallet: 'asc' }] });
    return rows.map(({ eventId: _event, ...w }) => w);
  }

  async recordPayout(eventId: string, wallet: string, txSignature: string, by: string, at: Date, tx: TransactionHandle): Promise<PayoutOutcome> {
    const db = clientFor(this.prisma, tx);
    const row = await db.eventWinner.findUnique({ where: { eventId_wallet: { eventId, wallet } }, select: { txSignature: true } });
    if (!row) return 'not_a_winner';
    if (row.txSignature !== null) return 'already_paid';
    if (await db.eventWinner.findFirst({ where: { txSignature }, select: { wallet: true } })) return 'signature_used';
    try {
      const { count } = await db.eventWinner.updateMany({ where: { eventId, wallet, txSignature: null }, data: { txSignature, paidAt: at, recordedBy: by } });
      return count === 1 ? 'recorded' : 'already_paid';
    } catch (error) {
      if (isUniqueViolation(error)) return 'signature_used';   // a different winner took the same signature between the check and the write; the caller's transaction is aborted
      throw error;
    }
  }
}

function toReview(r: { wallet: string; disqualified: boolean; prizeEligibleOverride: boolean | null; note: string | null; sanctionsCheckedAt: Date | null; sanctionsClean: boolean | null; sanctionsRef: string | null; updatedBy: string; updatedAt: Date }): EventReviewRecord {
  return { wallet: r.wallet, disqualified: r.disqualified, prizeEligibleOverride: r.prizeEligibleOverride === false ? false : null, note: r.note, sanctionsCheckedAt: r.sanctionsCheckedAt, sanctionsClean: r.sanctionsClean, sanctionsRef: r.sanctionsRef, updatedBy: r.updatedBy, updatedAt: r.updatedAt };
}
