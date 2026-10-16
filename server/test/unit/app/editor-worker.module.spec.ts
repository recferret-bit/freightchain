import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../../../src/app/app.module.js';
import { EditorWorkerModule } from '../../../src/app/editor-worker.module.js';
import { ApplicationModule } from '../../../src/application/application.module.js';
import { EditorAgentService } from '../../../src/application/services/editor-agent.service.js';
import { EditorJobRunnerService } from '../../../src/application/services/editor-job-runner.service.js';
import { EditorJobSweepScheduler } from '../../../src/infrastructure/scheduling/editor-job-sweep.scheduler.js';
import { SweepEditorJobsHandler } from '../../../src/application/use-cases/editor/sweep-editor-jobs/sweep-editor-jobs.handler.js';

/** Composition is the permission boundary: importing the HTTP app must not instantiate a generation runner. */
describe('EditorWorkerModule isolation', () => {
  const providers = (m: object): unknown[] => Reflect.getMetadata(MODULE_METADATA.PROVIDERS, m) as unknown[];
  it('AI agent, runner, sweep handler and scheduler are registered only in the worker root', () => {
    const worker = providers(EditorWorkerModule), http = [...providers(AppModule), ...providers(ApplicationModule)];
    for (const dependency of [EditorAgentService, EditorJobRunnerService, SweepEditorJobsHandler, EditorJobSweepScheduler]) {
      expect(worker).toContain(dependency);
      expect(http).not.toContain(dependency);
    }
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, EditorWorkerModule) ?? []).toEqual([]);
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, EditorWorkerModule)).not.toContain(ApplicationModule);
  });
});
