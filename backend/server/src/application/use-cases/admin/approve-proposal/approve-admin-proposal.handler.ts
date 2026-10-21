import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AdminApprovalService } from '../../../services/admin-approval.service.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { AdminModerationCommand } from '../moderate/admin-moderation.command.js';
import { HoldPoolPayoutCommand } from '../hold-pool-payout/hold-pool-payout.command.js';
import { UpdateSettingCommand } from '../update-setting/update-setting.command.js';
import type { VerdictDecision } from '../../../../domain/verdict/verdict.dto.js';
import { OverrideVerdictCommand } from '../override-verdict/override-verdict.command.js';
import { RejudgeRideCommand } from '../rejudge-ride/rejudge-ride.command.js';
import { CreateAdminPromoCommand } from '../create-admin-promo/create-admin-promo.command.js';
import { ApproveAdminProposalCommand, type ApprovedProposalDto } from './approve-admin-proposal.command.js';

/** The second admin. The original signature is still unused, so the same command runs now. */
@CommandHandler(ApproveAdminProposalCommand)
export class ApproveAdminProposalHandler implements ICommandHandler<ApproveAdminProposalCommand, ApprovedProposalDto> {
  constructor(
    private readonly approval: AdminApprovalService,
    private readonly commands: CommandBus,
    private readonly audit: AdminActionRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ id, wallet, requestId }: ApproveAdminProposalCommand): Promise<ApprovedProposalDto> {
    const row = await this.approval.approve(id, wallet);
    const payload = row.payload;
    const path = String(payload.path ?? row.action);
    const body = (payload.body ?? {}) as Record<string, unknown>;
    try {
      await this.dispatch(row.proposerWallet, path, body, requestId); // the stored command runs as the proposer
      await this.approval.applied(id);
    } catch (error) {
      await this.approval.release(id);
      throw error;
    }
    await this.audit.insert({
      wallet, action: 'proposal.approve', target: id, role: 'admin', requestId, at: this.clock.now(),
      beforeState: { status: 'pending' }, afterState: { status: 'applied', path }, detail: { proposer: row.proposerWallet },
    });
    return { ok: true, status: 'applied', id };
  }

  private async dispatch(admin: string, path: string, body: Record<string, unknown>, requestId: string | null) {
    const ride = /^\/api\/admin\/rides\/([^/]+)\/(verdict|rejudge)$/.exec(path);
    if (ride?.[2] === 'verdict') {
      await this.commands.execute(new OverrideVerdictCommand(admin, ride[1] as string, body.decision as VerdictDecision, (body.note as string | null) ?? null, requestId, String(body.signature ?? '')));
      return;
    }
    if (ride?.[2] === 'rejudge') {
      await this.commands.execute(new RejudgeRideCommand(admin, ride[1] as string, requestId, String(body.signature ?? '')));
      return;
    }
    const hold = /^\/api\/admin\/pools\/(\d+)\/hold$/.exec(path);
    if (hold) {
      await this.commands.execute(new HoldPoolPayoutCommand(admin, Number(hold[1]), Boolean(body.hold), (body.note as string | null) ?? null, requestId, String(body.signature ?? '')));
      return;
    }
    if (path === '/api/admin/settings') {
      await this.commands.execute(new UpdateSettingCommand(admin, String(body.key), Number(body.value), requestId, String(body.signature ?? '')));
      return;
    }
    if (path === '/api/admin/promos') {
      await this.commands.execute(new CreateAdminPromoCommand(admin, body.promo as never, requestId, String(body.signature ?? '')));
      return;
    }
    if (path === '/api/admin/pools/rules') {
      await this.commands.execute(new AdminModerationCommand('pool.rules', admin, 'rules', body, requestId));
      return;
    }
    await this.commands.execute(new AdminModerationCommand('program.config', admin, 'config', body, requestId));
  }
}
