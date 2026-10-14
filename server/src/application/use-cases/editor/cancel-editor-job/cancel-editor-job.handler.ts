import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { OPEN_STATUSES } from '../../../../domain/editor/editor-job.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { EditorJobRepositoryPort } from '../../../ports/editor/editor-job.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EditorJobRunnerService } from '../../../services/editor-job-runner.service.js';
import type { LogoutResultDto } from '../../auth/logout/logout.command.js';
import { CancelEditorJobCommand } from './cancel-editor-job.command.js';

/** Only the editor who asked may cancel. A job already over is left as it is (still { ok: true }); one this process does not run (a restart) is cancelled in the table. */
@CommandHandler(CancelEditorJobCommand)
export class CancelEditorJobHandler implements ICommandHandler<CancelEditorJobCommand, LogoutResultDto> {
  constructor(private readonly jobs: EditorJobRepositoryPort, private readonly runner: EditorJobRunnerService, private readonly clock: ClockPort) {}

  async execute({ wallet, jobId }: CancelEditorJobCommand): Promise<LogoutResultDto> {
    const job = await this.jobs.find(jobId);
    if (!job || job.wallet !== wallet) throw new NotFoundError('no such job', 'job_not_found');
    if (!OPEN_STATUSES.includes(job.status)) return { ok: true };
    if (!(await this.runner.cancel(jobId)) && (await this.jobs.update(jobId, { status: 'cancelled', finishedAt: this.clock.now() }, OPEN_STATUSES))) {
      await this.jobs.appendEvent(jobId, 'status', { status: 'cancelled' }, this.clock.now());
      await this.jobs.appendEvent(jobId, 'error', { status: 'cancelled', message: 'cancelled' }, this.clock.now());
    }
    return { ok: true };
  }
}
