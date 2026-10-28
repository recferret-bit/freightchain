import { Injectable } from '@nestjs/common';
import { sanctionsFresh, trustBlocked, type EventCandidateDto, type EventGeoAccess } from '../../domain/prize/event-dto.js';
import {
  EVENT_CANDIDATE_LIMIT, EVENT_PLAY_ONLY_COUNTRIES, EVENT_PRIZE_TABLE_CENTS, eventPrizeGeoEligible, settleFixedTableBoard, type EventEntry, type EventSettlement,
} from '../../domain/prize/event-settlement.js';
import { eventReviewSchedule, type EventPhase } from '../../domain/settings/preseason-event.js';
import { EventSettlementRepositoryPort, type EventReviewRecord, type EventStateRecord, type EventWinnerRecord } from '../ports/prize/event-settlement.repository.port.js';
import { PrizeGeoPort } from '../ports/prize/prize-geo.port.js';
import { SignInRepositoryPort } from '../ports/auth/sign-in.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import type { TransactionHandle } from '../ports/shared/transaction.port.js';
import { GameSettingsService } from './game-settings.service.js';

export interface EventView {
  eventId: string;
  phase: EventPhase;
  now: Date;
  /** null until the three dates are set in the right order: no schedule, no public table, no lock */
  schedule: { reviewEnd: Date; appealsEnd: Date } | null;
  state: EventStateRecord;
  table: readonly number[];
  tableIsDefault: boolean;
  settlement: EventSettlement;
  candidates: EventCandidateDto[];
  winners: EventWinnerRecord[];
}

/** Builds the ranked event board from the qualifying rides, the geo lists, the admin's review flags and the prize table – one read model for the admin tab, the public table and the lock. */
@Injectable()
export class EventSettlementService {
  constructor(
    private readonly repo: EventSettlementRepositoryPort,
    private readonly signIns: SignInRepositoryPort,
    private readonly settings: GameSettingsService,
    private readonly geo: PrizeGeoPort,
    private readonly clock: ClockPort,
  ) {}

  async view(eventId: string, tx?: TransactionHandle): Promise<EventView> {
    const now = this.clock.now();
    const settings = await this.settings.current(tx);
    const schedule = eventReviewSchedule(settings);
    const state = await this.repo.state(eventId, tx);
    const table = state.prizeTableCents ?? EVENT_PRIZE_TABLE_CENTS;
    const window = settings.eventWeekStartUtc > 0 && settings.eventWeekEndUtc > settings.eventWeekStartUtc
      ? { start: new Date(settings.eventWeekStartUtc * 1000), end: new Date(settings.eventWeekEndUtc * 1000) } : null;
    const rows = window ? await this.repo.listCandidates(window, tx) : [];
    const reviews = new Map((await this.repo.reviews(eventId, tx)).map((r) => [r.wallet, r]));
    const geo = this.geo.rules();
    const geoOf = (country: string | null, region: string | null): EventGeoAccess => (
      eventPrizeGeoEligible(country, region, geo) ? 'eligible' : EVENT_PLAY_ONLY_COUNTRIES.includes((country ?? '').toUpperCase()) ? 'play_only_no_prizes' : 'no_prizes');
    const entries: EventEntry[] = rows.map((r) => {
      const review = reviews.get(r.wallet);
      return { wallet: r.wallet, rideId: r.rideId, bps: r.bps, prizeEligible: geoOf(r.country, r.region) === 'eligible' && review?.prizeEligibleOverride !== false, disqualified: review?.disqualified === true };
    });
    const settlement = settleFixedTableBoard(entries, table);
    const byWallet = new Map(rows.map((r) => [r.wallet, r]));
    const shown = [
      ...settlement.rows.slice(0, EVENT_CANDIDATE_LIMIT),
      ...entries.filter((e) => e.disqualified).map((e) => ({ wallet: e.wallet, rideId: e.rideId, bps: e.bps, rank: 0, prizeEligible: false, place: null, amountCents: 0 })),
    ];
    const ips = new Map((await this.signIns.summaryOf(shown.map((r) => r.wallet))).map((s) => [s.wallet, s.ips]));
    const candidates = shown.map((row): EventCandidateDto => {
      const r = byWallet.get(row.wallet)!, review: EventReviewRecord | undefined = reviews.get(row.wallet), mine = ips.get(row.wallet) ?? [];
      return {
        ...row, country: r.country, region: r.region, geoAccess: geoOf(r.country, r.region), trustScore: r.trustScore, trustBlocked: trustBlocked(r.trustScore), attempts: r.attempts, endedAt: r.endedAt.getTime(),
        ipPrefixHmac: mine.map((h) => h.slice(0, 8)),
        ipOverlaps: shown.filter((o) => o.wallet !== row.wallet && (ips.get(o.wallet) ?? []).some((h) => mine.includes(h))).map((o) => o.wallet),
        disqualified: review?.disqualified === true, prizeEligibleOverride: review?.prizeEligibleOverride ?? null, note: review?.note ?? null,
        sanctionsCheckedAt: review?.sanctionsCheckedAt?.getTime() ?? null, sanctionsClean: review?.sanctionsClean ?? null, sanctionsFresh: sanctionsFresh(review ?? null, now),
      };
    });
    const phase: EventPhase = state.lockedAt ? 'final' : schedule && now >= schedule.reviewEnd ? 'preliminary' : 'pending';
    return { eventId, phase, now, schedule, state, table, tableIsDefault: state.prizeTableCents === null, settlement, candidates, winners: await this.repo.winners(eventId, tx) };
  }
}
