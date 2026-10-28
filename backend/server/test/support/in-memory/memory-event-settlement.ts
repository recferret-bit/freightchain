import { EventSettlementRepositoryPort, type EventCandidateRow, type EventReviewRecord, type EventStateRecord, type EventWinnerRecord, type PayoutOutcome } from '../../../src/application/ports/prize/event-settlement.repository.port.js';
import { bestAttemptPerWallet, eventAttemptBps } from '../../../src/domain/prize/event-settlement.js';
import { PRESEASON_PROMO_CODE } from '../../../src/domain/settings/preseason-event.js';
import type { MemoryDb } from './memory-db.js';

/** In-memory twin of the Prisma adapter: the same qualification rule, and every conditional write is a check-and-set with no await between (one event loop turn = atomic). */
export class MemoryEventSettlementRepository extends EventSettlementRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async listCandidates(window: { start: Date; end: Date }, _tx?: unknown): Promise<EventCandidateRow[]> {
    const rows: EventCandidateRow[] = [];
    for (const { props: r } of this.db.rides.values()) {
      if (r.promoCode !== PRESEASON_PROMO_CODE || !r.ranked || r.tier !== '1h' || String(r.status) !== 'completed') continue;
      if (!r.startedAt || r.startedAt < window.start || !r.endedAt || r.endedAt > window.end) continue;
      if (this.db.verdicts.get(r.id)?.status !== 'verified') continue;
      rows.push({ wallet: r.wallet, rideId: r.id, bps: eventAttemptBps(r.cleanMetres ?? null, r.lastS, r.completeDist), country: r.prizeCountry ?? null, region: r.prizeRegion ?? null, trustScore: this.db.players.get(r.wallet)?.trustScore ?? 60, endedAt: r.endedAt, attempts: 1 });
    }
    return bestAttemptPerWallet(rows);
  }

  async reviews(eventId: string, _tx?: unknown): Promise<EventReviewRecord[]> {
    return [...this.db.eventReviews.entries()].filter(([k]) => k.startsWith(`${eventId}|`)).map(([, v]) => ({ ...v })).sort((a, b) => (a.wallet < b.wallet ? -1 : 1));
  }

  async review(eventId: string, wallet: string, _tx?: unknown): Promise<EventReviewRecord | null> {
    const r = this.db.eventReviews.get(`${eventId}|${wallet}`);
    return r ? { ...r } : null;
  }

  async saveReview(eventId: string, record: EventReviewRecord, _tx?: unknown): Promise<void> { this.db.eventReviews.set(`${eventId}|${record.wallet}`, { ...record }); }

  async state(eventId: string, _tx?: unknown): Promise<EventStateRecord> {
    const c = this.db.eventConfigs.get(eventId);
    return c ? { ...c } : { prizeTableCents: null, lockedAt: null, lockedBy: null };
  }

  async setPrizeTable(eventId: string, cents: readonly number[], _tx?: unknown): Promise<boolean> {
    const c = this.db.eventConfigs.get(eventId) ?? { prizeTableCents: null, lockedAt: null, lockedBy: null };
    if (c.lockedAt) return false;
    this.db.eventConfigs.set(eventId, { ...c, prizeTableCents: [...cents] });
    return true;
  }

  async lock(eventId: string, by: string, at: Date, winners: readonly EventWinnerRecord[], _tx?: unknown): Promise<boolean> {
    const c = this.db.eventConfigs.get(eventId) ?? { prizeTableCents: null, lockedAt: null, lockedBy: null };
    if (c.lockedAt) return false;
    this.db.eventConfigs.set(eventId, { ...c, lockedAt: at, lockedBy: by });
    for (const w of winners) this.db.eventWinners.set(`${eventId}|${w.wallet}`, { ...w, eventId });
    return true;
  }

  async winners(eventId: string, _tx?: unknown): Promise<EventWinnerRecord[]> {
    return [...this.db.eventWinners.values()].filter((w) => w.eventId === eventId).map(({ eventId: _e, ...w }) => w).sort((a, b) => a.place - b.place || (a.wallet < b.wallet ? -1 : 1));
  }

  async recordPayout(eventId: string, wallet: string, txSignature: string, by: string, at: Date, _tx?: unknown): Promise<PayoutOutcome> {
    const w = this.db.eventWinners.get(`${eventId}|${wallet}`);
    if (!w) return 'not_a_winner';
    if (w.txSignature !== null) return 'already_paid';
    if ([...this.db.eventWinners.values()].some((o) => o.txSignature === txSignature)) return 'signature_used';
    this.db.eventWinners.set(`${eventId}|${wallet}`, { ...w, txSignature, paidAt: at, recordedBy: by });
    return 'recorded';
  }
}
