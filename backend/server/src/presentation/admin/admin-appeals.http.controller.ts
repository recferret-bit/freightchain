import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { z } from 'zod';
import type { ChallengeDto } from '../../application/use-cases/auth/request-challenge/request-challenge.command.js';
import { RequestActionChallengeCommand } from '../../application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { ListRideAppealsQuery, ResolveRideAppealCommand, type RideAppealDto } from '../../application/use-cases/rides/ride-appeal/ride-appeal.command.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams, ZodQuery } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { AdminGuard } from '../../infrastructure/http/guards/admin.guard.js';
import { Roles } from '../../infrastructure/http/guards/privileged.decorator.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { adminChallengeResponse } from '../common/response/admin.response.js';
import { num, numOrNull, obj, str } from '../common/response/wire.js';

const appealDto = obj({
  id: str, rideId: str, poolId: num, wallet: str, status: z.enum(['open', 'upheld', 'denied']), reason: str, createdAt: num, resolvedAt: numOrNull,
});
const appealListResponse = obj({ appeals: z.array(appealDto) });
export const appealBodySchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
const listQuerySchema = z.object({ poolId: z.coerce.number().int().min(0).optional() }).strict();
const idParams = z.object({ id: z.string().min(1).max(80) }).strict();
const resolveBody = z.object({
  decision: z.enum(['upheld', 'denied']),
  note: z.string().trim().max(300).nullable(),
  signature: z.string().min(1),
}).strict();
const challengeBody = z.object({
  decision: z.enum(['upheld', 'denied']),
  note: z.string().trim().max(300).nullable(),
}).strict();

/** Signed admin review of pool-ride appeals. `set_pool_rules` stays off this HTTP surface (SPC-05.6). */
@Controller('api/admin/appeals')
@UseGuards(AdminGuard)
@Roles('admin')
export class AdminAppealsHttpController {
  constructor(private readonly commandBus: CommandBus, private readonly queryBus: QueryBus) {}

  @Get()
  @ZodResponse(appealListResponse)
  list(@ZodQuery(listQuerySchema) query: z.infer<typeof listQuerySchema>): Promise<{ appeals: RideAppealDto[] }> {
    return this.queryBus.execute(new ListRideAppealsQuery(query.poolId));
  }

  @Post(':id/challenge') @HttpCode(200)
  @ZodResponse(adminChallengeResponse)
  challenge(@CurrentPlayer() admin: PlayerIdentity, @ZodParams(idParams) params: z.infer<typeof idParams>, @ZodBody(challengeBody) body: z.infer<typeof challengeBody>): Promise<ChallengeDto> {
    return this.commandBus.execute(new RequestActionChallengeCommand(admin.wallet, { action: 'appeal_resolve', appealId: params.id, decision: body.decision, note: body.note }));
  }

  @Post(':id') @HttpCode(200)
  @ZodResponse(appealDto)
  resolve(@CurrentPlayer() admin: PlayerIdentity, @ZodParams(idParams) params: z.infer<typeof idParams>, @ZodBody(resolveBody) body: z.infer<typeof resolveBody>): Promise<RideAppealDto> {
    return this.commandBus.execute(new ResolveRideAppealCommand(admin.wallet, params.id, body.decision, body.note, body.signature));
  }
}
