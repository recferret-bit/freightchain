import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { EditorAgentService } from '../application/services/editor-agent.service.js';
import { EditorJobRunnerService } from '../application/services/editor-job-runner.service.js';
import { GameSettingsService } from '../application/services/game-settings.service.js';
import { SweepEditorJobsHandler } from '../application/use-cases/editor/sweep-editor-jobs/sweep-editor-jobs.handler.js';
import { EnvModule } from '../infrastructure/config/env.module.js';
import { InfrastructureModule } from '../infrastructure/infrastructure.module.js';
import { EditorJobSweepScheduler } from '../infrastructure/scheduling/editor-job-sweep.scheduler.js';

/** AI execution only: no HTTP listener, static files, replay scheduler, pool jobs or publication handlers. */
@Module({
  imports: [EnvModule, CqrsModule.forRoot(), InfrastructureModule],
  providers: [GameSettingsService, EditorAgentService, EditorJobRunnerService, SweepEditorJobsHandler, EditorJobSweepScheduler],
})
export class EditorWorkerModule {}
