import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { OPEN_STATUSES } from '../../../../domain/editor/editor-job.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { EditorJobRepositoryPort } from '../../../ports/editor/editor-job.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import type { LogoutResultDto } from '../../auth/logout/logout.command.js';
import { CancelEditorJobCommand } from './cancel-editor-job.command.js';

/** Only the editor who asked may cancel. A job already over is left as it is (still { ok: true }); cancellation revokes the shared capability; the owning process observes it on its next poll. */
@CommandHandler(CancelEditorJobCommand)
export class CancelEditorJobHandler implements ICommandHandler<CancelEditorJobCommand, LogoutResultDto> {
  constructor(private readonly jobs: EditorJobRepositoryPort, private readonly clock: ClockPort) {}

  async execute({ wallet, jobId }: CancelEditorJobCommand): Promise<LogoutResultDto> {
    const job = await this.jobs.find(jobId);
    if (!job || job.wallet !== wallet) throw new NotFoundError('no such job', 'job_not_found');
    if (!OPEN_STATUSES.includes(job.status)) return { ok: true };
    await this.jobs.conclude(jobId, 'cancelled', null, this.clock.now());
    return { ok: true };
  }
}
