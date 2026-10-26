import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { z } from 'zod';
import { TelegramActivityCommand } from '../../application/airdrop/telegram-activity.command.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { TelegramWebhookGuard } from '../../infrastructure/http/guards/telegram-webhook.guard.js';
import { CrossOriginPublic } from '../../infrastructure/http/guards/origin.guard.js';
import { okResponse } from '../common/response/wire.js';

const id = z.number().int().safe();
export const telegramUpdateSchema = z.object({
  update_id: id,
  message: z.object({
    date: id.nonnegative(), text: z.string().max(4096).optional(),
    from: z.object({ id: id.positive(), is_bot: z.boolean() }).optional(),
    chat: z.object({ id, type: z.string().max(32), username: z.string().max(64).optional() }),
    forward_origin: z.unknown().optional(),
  }).optional(),
});

@CrossOriginPublic()
@Controller('api/airdrop/telegram')
export class TelegramWebhookHttpController {
  constructor(private readonly commandBus: CommandBus) {}
  @Post('webhook') @HttpCode(200) @UseGuards(TelegramWebhookGuard)
  @ZodResponse(okResponse)
  receive(@ZodBody(telegramUpdateSchema) body: z.infer<typeof telegramUpdateSchema>): Promise<{ ok: true }> {
    return this.commandBus.execute<TelegramActivityCommand, { ok: true }>(new TelegramActivityCommand(body));
  }
}
