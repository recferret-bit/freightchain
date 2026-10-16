import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { EditorJobRunnerService } from '../../../services/editor-job-runner.service.js';
import { SweepEditorJobsCommand, type SweepEditorJobsResultDto } from './sweep-editor-jobs.command.js';

@CommandHandler(SweepEditorJobsCommand)
export class SweepEditorJobsHandler implements ICommandHandler<SweepEditorJobsCommand, SweepEditorJobsResultDto> {
  constructor(private readonly runner: EditorJobRunnerService) {}

  async execute(_command: SweepEditorJobsCommand): Promise<SweepEditorJobsResultDto> {
    return { failed: await this.runner.sweep() };
  }
}
