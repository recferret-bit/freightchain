import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { chainWebhookResponse } from '../common/response/rest.response.js';
import { CommandBus } from '@nestjs/cqrs';
import { ReceiveChainWebhookCommand, type ChainWebhookResultDto } from '../../application/use-cases/chain/receive-chain-webhook/receive-chain-webhook.command.js';
import { ZodBody } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { WebhookSecretGuard } from '../../infrastructure/http/guards/webhook-secret.guard.js';
import { chainWebhookBodySchema, type ChainWebhookBody } from './dto/chain.dto.js';
import { CrossOriginPublic } from '../../infrastructure/http/guards/origin.guard.js';

/** The chain pushing to us (QuickNode Streams filtered to the pool program, or a Helius webhook): 404 without WEBHOOK_SECRET, 401 with a wrong one. */
@CrossOriginPublic()   // any site may POST here without a session (audit H7: the Origin guard skips it)
@Controller('api/chain')
export class ChainWebhookHttpController {
  constructor(private readonly commandBus: CommandBus) {}

  /** 200 `{ received, settled, pending }` · 400 more signatures than one delivery may carry · 503 RPC down (the provider re-delivers). */
  @Post('webhook') @HttpCode(200) @UseGuards(WebhookSecretGuard)
  @ZodResponse(chainWebhookResponse)
  receive(@ZodBody(chainWebhookBodySchema) body: ChainWebhookBody): Promise<ChainWebhookResultDto> {
    return this.commandBus.execute<ReceiveChainWebhookCommand, ChainWebhookResultDto>(new ReceiveChainWebhookCommand(body.signatures));
  }
}
