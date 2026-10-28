import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminEventDto } from '../../../../domain/prize/event-dto.js';
import { EVENT_PRIZE_TABLE_CENTS } from '../../../../domain/prize/event-settlement.js';
import { PRESEASON_EVENT_ID } from '../../../../domain/prize/event-settlement.js';
import { EventSettlementService } from '../../../services/event-settlement.service.js';
import { GetAdminEventQuery } from './get-admin-event.query.js';

@QueryHandler(GetAdminEventQuery)
export class GetAdminEventHandler implements IQueryHandler<GetAdminEventQuery, AdminEventDto> {
  constructor(private readonly event: EventSettlementService) {}

  async execute(): Promise<AdminEventDto> {
    const v = await this.event.view(PRESEASON_EVENT_ID);
    return {
      eventId: v.eventId, phase: v.phase, now: v.now.getTime(), reviewEnd: v.schedule?.reviewEnd.getTime() ?? null, appealsEnd: v.schedule?.appealsEnd.getTime() ?? null,
      prizeTableCents: [...(v.state.prizeTableCents ?? EVENT_PRIZE_TABLE_CENTS)], tableIsDefault: v.tableIsDefault, locked: v.state.lockedAt !== null, lockedAt: v.state.lockedAt?.getTime() ?? null,
      paidCents: v.settlement.paidCents, organizerCents: v.settlement.organizerCents, candidates: v.candidates,
      winners: v.winners.map((w) => ({ wallet: w.wallet, place: w.place, amountCents: w.amountCents, bps: w.bps, rideId: w.rideId, txSignature: w.txSignature, paidAt: w.paidAt?.getTime() ?? null })),
    };
  }
}
