import { SweepEditorJobsHandler } from '../../../../../src/application/use-cases/editor/sweep-editor-jobs/sweep-editor-jobs.handler.js';
import { SweepEditorJobsCommand } from '../../../../../src/application/use-cases/editor/sweep-editor-jobs/sweep-editor-jobs.command.js';
import { aJob, jobContext } from '../../../../support/editor-job-fixtures.js';

describe('SweepEditorJobsHandler', () => {
  it('reports how many orphans the runner failed', async () => {
    const { jobs, runner, clock, settingsRepo } = jobContext(); await settingsRepo.upsert('editor_jobs_parallel', 0); await jobs.insert(aJob({ createdAt: clock.now() }));
    expect(await new SweepEditorJobsHandler(runner).execute(new SweepEditorJobsCommand())).toEqual({ failed: 0 });
    clock.advance(601);
    expect(await new SweepEditorJobsHandler(runner).execute(new SweepEditorJobsCommand())).toEqual({ failed: 1 });
  });
});
