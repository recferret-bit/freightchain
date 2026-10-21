import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { AdminModerationCommand, type ModerationResultDto } from '../../application/use-cases/admin/moderate/admin-moderation.command.js';
import { ApproveAdminProposalCommand, type ApprovedProposalDto } from '../../application/use-cases/admin/approve-proposal/approve-admin-proposal.command.js';
import { CurrentRequestId } from '../../infrastructure/http/decorators/client-info.js';
import { CurrentPlayer } from '../../infrastructure/http/decorators/current-player.js';
import { ZodBody, ZodParams } from '../../infrastructure/http/decorators/zod.js';
import { ZodResponse } from '../../infrastructure/http/decorators/zod-response.js';
import { AdminGuard } from '../../infrastructure/http/guards/admin.guard.js';
import { Roles } from '../../infrastructure/http/guards/privileged.decorator.js';
import type { PlayerIdentity } from '../../infrastructure/http/types/http-request.js';
import { moderationResponse, proposalApprovedResponse } from '../common/response/admin.response.js';
import { walletParamsSchema, type WalletParams } from './dto/admin-directory.dto.js';
import {
  chatBanBodySchema, eventIdParamsSchema, poolRulesBodySchema, programConfigBodySchema, proposalIdParamsSchema,
  type ChatBanBody, type EventIdParams, type PoolRulesBody, type ProgramConfigBody, type ProposalIdParams,
} from './dto/admin-moderation.dto.js';

/** Chat moderation (moderator or admin) and the dual-approval confirm. Chain config is recorded, not sent. */
@Controller('api/admin')
@UseGuards(AdminGuard)
@Roles('admin')
export class AdminModerationHttpController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('chat/:eventId/hide') @HttpCode(200) @Roles('admin', 'moderator')
  @ZodResponse(moderationResponse)
  hide(@CurrentPlayer() admin: PlayerIdentity, @ZodParams(eventIdParamsSchema) params: EventIdParams, @CurrentRequestId() requestId: string): Promise<ModerationResultDto> {
    return this.commandBus.execute(new AdminModerationCommand('chat.hide', admin.wallet, String(params.eventId), { hidden: true }, requestId));
  }

  @Post('players/:wallet/chat-ban') @HttpCode(200) @Roles('admin', 'moderator')
  @ZodResponse(moderationResponse)
  ban(@CurrentPlayer() admin: PlayerIdentity, @ZodParams(walletParamsSchema) params: WalletParams, @ZodBody(chatBanBodySchema) body: ChatBanBody, @CurrentRequestId() requestId: string): Promise<ModerationResultDto> {
    return this.commandBus.execute(new AdminModerationCommand('chat.ban', admin.wallet, params.wallet, { ban: body.ban }, requestId));
  }

  /** Same ban as `players/:wallet/chat-ban`. The replay spec calls it on `wallets`. */
  @Post('wallets/:wallet/chat-ban') @HttpCode(200) @Roles('admin', 'moderator')
  @ZodResponse(moderationResponse)
  banWallet(@CurrentPlayer() admin: PlayerIdentity, @ZodParams(walletParamsSchema) params: WalletParams, @ZodBody(chatBanBodySchema) body: ChatBanBody, @CurrentRequestId() requestId: string): Promise<ModerationResultDto> {
    return this.commandBus.execute(new AdminModerationCommand('chat.ban', admin.wallet, params.wallet, { ban: body.ban }, requestId));
  }

  @Post('pools/rules') @HttpCode(200)
  @ZodResponse(moderationResponse)
  rules(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(poolRulesBodySchema) body: PoolRulesBody, @CurrentRequestId() requestId: string): Promise<ModerationResultDto> {
    return this.commandBus.execute(new AdminModerationCommand('pool.rules', admin.wallet, String(body.poolId), { ...body }, requestId));
  }

  @Post('config') @HttpCode(200)
  @ZodResponse(moderationResponse)
  config(@CurrentPlayer() admin: PlayerIdentity, @ZodBody(programConfigBodySchema) body: ProgramConfigBody, @CurrentRequestId() requestId: string): Promise<ModerationResultDto> {
    return this.commandBus.execute(new AdminModerationCommand('program.config', admin.wallet, 'config', { ...body }, requestId));
  }

  @Post('proposals/:id/approve') @HttpCode(200)
  @ZodResponse(proposalApprovedResponse)
  approve(@CurrentPlayer() admin: PlayerIdentity, @ZodParams(proposalIdParamsSchema) params: ProposalIdParams, @CurrentRequestId() requestId: string): Promise<ApprovedProposalDto> {
    return this.commandBus.execute(new ApproveAdminProposalCommand(params.id, admin.wallet, requestId));
  }
}
