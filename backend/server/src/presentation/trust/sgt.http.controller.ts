import { Controller, Get, Post, HttpCode, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { GetSgtQuery, VerifySgtCommand, type SgtStatus } from '../../application/trust/sgt.handler.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { PlayerAuthGuard } from '../../infrastructure/http/guards/player-auth.guard.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';

export const sgtStatusSchema = z.object({ enabled: z.boolean(), claimed: z.boolean(), trustScore: z.number().int(), claimedAt: z.string().nullable() });
const emptyBody = z.object({}).strict();
@Controller('api/me/trust/sgt')
@UseGuards(PlayerAuthGuard)
export class SgtHttpController {
  constructor(private readonly commandBus: CommandBus, private readonly queryBus: QueryBus) {}
  @Get()
  @ZodResponse(sgtStatusSchema)
  status(@CurrentPlayer() player: PlayerIdentity): Promise<SgtStatus> {
    return this.queryBus.execute(new GetSgtQuery(player.wallet));
  }
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ZodResponse(sgtStatusSchema)
  verify(@CurrentPlayer() player: PlayerIdentity, @ZodBody(emptyBody) _body: Record<string, never>): Promise<SgtStatus> {
    return this.commandBus.execute(new VerifySgtCommand(player.wallet));
  }
}
