import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { LiveChatService } from '../../../live/live-chat.service.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { AdminModerationCommand, type ModerationResultDto } from './admin-moderation.command.js';

/** Records a moderation or chain-shaped admin action. The chain itself stays a Squads multisig; this row is the server's audit. */
@CommandHandler(AdminModerationCommand)
export class AdminModerationHandler implements ICommandHandler<AdminModerationCommand, ModerationResultDto> {
  constructor(
    private readonly audit: AdminActionRepositoryPort,
    private readonly clock: ClockPort,
    private readonly chat: LiveChatService,
  ) {}

  async execute({ kind, wallet, target, body, requestId }: AdminModerationCommand): Promise<ModerationResultDto> {
    if (kind === 'chat.hide') await this.chat.hide(Number(target));
    const status = kind === 'program.config' ? 'squads' : kind === 'pool.rules' ? 'recorded' : 'applied';
    const now = this.clock.now();
    await this.audit.insert({
      wallet, action: kind, target, role: 'moderator', requestId, at: now,
      beforeState: {}, afterState: body, detail: { status },
    });
    return { ok: true, status };
  }
}
