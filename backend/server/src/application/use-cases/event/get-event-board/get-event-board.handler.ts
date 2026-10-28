import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { shortWallet, solscanTxUrl, type PublicEventBoardDto, type PublicEventRowDto } from '../../../../domain/prize/event-dto.js';
import { PRESEASON_EVENT_ID } from '../../../../domain/prize/event-settlement.js';
import { EventSettlementService } from '../../../services/event-settlement.service.js';
import { GetEventBoardQuery } from './get-event-board.query.js';

const BOARD_RANKS = 20;

/**
 * Preliminary after the review end (live ranking), final once the list is locked (never before the appeals end: the frozen winners), nothing otherwise. Wallets are shortened.
 * In the preliminary table an ineligible (RU/BY...) wallet stays visible while its rank is inside the first twenty, marked as outside the prize standings; the board never says why.
 */
@QueryHandler(GetEventBoardQuery)
export class GetEventBoardHandler implements IQueryHandler<GetEventBoardQuery, PublicEventBoardDto> {
  constructor(private readonly event: EventSettlementService) {}

  async execute(): Promise<PublicEventBoardDto> {
    const v = await this.event.view(PRESEASON_EVENT_ID);
    const head = { eventId: v.eventId, phase: v.phase, reviewEnd: v.schedule?.reviewEnd.getTime() ?? null, appealsEnd: v.schedule?.appealsEnd.getTime() ?? null };
    if (v.phase === 'pending') return { ...head, rows: [] };
    if (v.phase === 'final') {
      // the frozen list, not a recomputation: a later verdict change or a zeroed event window must not remove a locked winner or his transaction link
      const live = new Map(v.settlement.rows.map((r) => [r.wallet, r.rank]));
      return { ...head, rows: v.winners.map((w): PublicEventRowDto => ({ rank: live.get(w.wallet) ?? w.place, place: w.place, wallet: shortWallet(w.wallet), bps: w.bps, amountCents: w.amountCents, prizeEligible: true, txSignature: w.txSignature, solscanUrl: w.txSignature ? solscanTxUrl(w.txSignature) : null })) };
    }
    return { ...head, rows: v.settlement.rows.filter((r) => r.amountCents > 0 || r.rank <= BOARD_RANKS).map((r) => ({ rank: r.rank, place: r.place, wallet: shortWallet(r.wallet), bps: r.bps, amountCents: r.amountCents, prizeEligible: r.prizeEligible, txSignature: null, solscanUrl: null })) };
  }
}
