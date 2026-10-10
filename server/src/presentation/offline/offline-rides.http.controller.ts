import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ClaimOfflineRideCommand, type OfflineRideDto } from '../../application/use-cases/offline/claim-offline-ride/claim-offline-ride.command.js';
import { GetOfflineRidesQuery } from '../../application/use-cases/offline/get-offline-rides/get-offline-rides.query.js';
import { CurrentClient } from '../../infrastructure/http/decorators/client-info.js';
import { OptionalSession } from '../../infrastructure/http/decorators/optional-session.js';
import { ZodBody, ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import { OptionalSessionGuard } from '../../infrastructure/http/guards/optional-session.guard.js';
import type { ClientInfo } from '../../domain/auth/sign-in.js';
import { offlineBodySchema, offlineQuerySchema, type OfflineBody, type OfflineQuery } from './dto/offline-rides.dto.js';

/** Anonymous free runs on `play.html?offline=1`. The address is the server's (`TRUST_PROXY`); a session cookie, when it verifies, does not spend a credit. */
@Controller('api/offline-rides')
@UseGuards(OptionalSessionGuard)
export class OfflineRidesHttpController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  status(@OptionalSession() wallet: string | null, @ZodQuery(offlineQuerySchema) query: OfflineQuery, @CurrentClient() client: ClientInfo): Promise<OfflineRideDto> {
    return this.queryBus.execute<GetOfflineRidesQuery, OfflineRideDto>(new GetOfflineRidesQuery(wallet, query.fingerprint, client.ip));
  }

  @Post() @HttpCode(200)
  claim(@OptionalSession() wallet: string | null, @ZodBody(offlineBodySchema) body: OfflineBody, @CurrentClient() client: ClientInfo): Promise<OfflineRideDto> {
    return this.commandBus.execute<ClaimOfflineRideCommand, OfflineRideDto>(new ClaimOfflineRideCommand(wallet, body.fingerprint, client.ip));
  }
}
