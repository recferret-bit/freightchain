import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { AdminEventDto } from '../../domain/prize/event-dto.js';
import type { AdminIntent } from '../../domain/admin/admin-proof.js';
import type { ChallengeDto } from '../../application/use-cases/auth/request-challenge/request-challenge.command.js';
import { RequestActionChallengeCommand } from '../../application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { CheckEventSanctionsCommand } from '../../application/use-cases/event/check-event-sanctions/check-event-sanctions.command.js';
import { GetAdminEventQuery } from '../../application/use-cases/event/get-admin-event/get-admin-event.query.js';
import { LockEventListCommand, type EventLockedDto } from '../../application/use-cases/event/lock-event-list/lock-event-list.command.js';
import { RecordEventPayoutCommand, type EventPayoutDto } from '../../application/use-cases/event/record-event-payout/record-event-payout.command.js';
import { ReviewEventWalletCommand } from '../../application/use-cases/event/review-event-wallet/review-event-wallet.command.js';
import { SetEventPrizeTableCommand } from '../../application/use-cases/event/set-event-prize-table/set-event-prize-table.command.js';
import type { EventReviewRecord } from '../../application/ports/prize/event-settlement.repository.port.js';
import { PRESEASON_EVENT_ID } from '../../domain/prize/event-settlement.js';
import { CurrentRequestId } from '../../infrastructure/http/decorators/client-info.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { AdminGuard } from '../../infrastructure/http/guards/admin.guard.js';
import { Roles } from '../../infrastructure/http/guards/privileged.decorator.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { adminChallengeResponse } from '../common/response/admin.response.js';
import {
  adminEventResponse, eventChallengeBodySchema, eventLockedResponse, eventPayoutResponse, eventPrizeTableResponse, eventReviewResponse, lockBodySchema, payoutBodySchema, prizeTableBodySchema,
  reviewBodySchema, sanctionsBodySchema, type EventChallengeBody,
} from './dto/event.dto.js';
import type { z } from 'zod';

const reviewDto = (r: EventReviewRecord) => ({
  wallet: r.wallet, disqualified: r.disqualified, prizeEligibleOverride: r.prizeEligibleOverride, note: r.note, sanctionsCheckedAt: r.sanctionsCheckedAt?.getTime() ?? null,
  sanctionsClean: r.sanctionsClean, sanctionsRef: r.sanctionsRef, updatedBy: r.updatedBy, updatedAt: r.updatedAt.getTime(),
});

/** The $500 event's review and payout record. Every change is signed by the admin wallet for exactly that change and audited; no server key moves money. */
@Controller('api/admin/event')
@UseGuards(AdminGuard)
@Roles('admin')
export class AdminEventHttpController {
  constructor(private readonly commandBus: CommandBus, private readonly queryBus: QueryBus) {}

  @Get()
  @ZodResponse(adminEventResponse)
  event(): Promise<AdminEventDto> {
    return this.queryBus.execute<GetAdminEventQuery, AdminEventDto>(new GetAdminEventQuery());
  }

  @Post('challenge') @HttpCode(200)
  @ZodResponse(adminChallengeResponse)
  challenge(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(eventChallengeBodySchema) body: EventChallengeBody): Promise<ChallengeDto> {
    const intent: AdminIntent = body.action === 'event_lock' ? { action: 'event_lock', eventId: PRESEASON_EVENT_ID }
      : body.action === 'event_review' ? { action: 'event_review', wallet: body.wallet, disqualified: body.disqualified, prizeEligible: body.prizeEligible, note: body.note } : body;
    return this.commandBus.execute<RequestActionChallengeCommand, ChallengeDto>(new RequestActionChallengeCommand(admin.wallet, intent));
  }

  @Post('review') @HttpCode(200)
  @ZodResponse(eventReviewResponse)
  async review(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(reviewBodySchema) body: z.infer<typeof reviewBodySchema>, @CurrentRequestId() requestId: string): Promise<ReturnType<typeof reviewDto>> {
    return reviewDto(await this.commandBus.execute<ReviewEventWalletCommand, EventReviewRecord>(new ReviewEventWalletCommand(admin.wallet, body.wallet, body.disqualified, body.prizeEligible, body.note, requestId, body.signature)));
  }

  @Post('sanctions') @HttpCode(200)
  @ZodResponse(eventReviewResponse)
  async sanctions(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(sanctionsBodySchema) body: z.infer<typeof sanctionsBodySchema>, @CurrentRequestId() requestId: string): Promise<ReturnType<typeof reviewDto>> {
    return reviewDto(await this.commandBus.execute<CheckEventSanctionsCommand, EventReviewRecord>(new CheckEventSanctionsCommand(admin.wallet, body.wallet, requestId, body.signature)));
  }

  @Post('prize-table') @HttpCode(200)
  @ZodResponse(eventPrizeTableResponse)
  prizeTable(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(prizeTableBodySchema) body: z.infer<typeof prizeTableBodySchema>, @CurrentRequestId() requestId: string): Promise<{ prizeTableCents: number[] }> {
    return this.commandBus.execute(new SetEventPrizeTableCommand(admin.wallet, body.cents, requestId, body.signature));
  }

  @Post('lock') @HttpCode(200)
  @ZodResponse(eventLockedResponse)
  lock(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(lockBodySchema) body: z.infer<typeof lockBodySchema>, @CurrentRequestId() requestId: string): Promise<EventLockedDto> {
    return this.commandBus.execute<LockEventListCommand, EventLockedDto>(new LockEventListCommand(admin.wallet, requestId, body.signature));
  }

  @Post('payouts') @HttpCode(200)
  @ZodResponse(eventPayoutResponse)
  payout(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(payoutBodySchema) body: z.infer<typeof payoutBodySchema>, @CurrentRequestId() requestId: string): Promise<EventPayoutDto> {
    return this.commandBus.execute<RecordEventPayoutCommand, EventPayoutDto>(new RecordEventPayoutCommand(admin.wallet, body.wallet, body.txSignature, requestId, body.signature));
  }
}
