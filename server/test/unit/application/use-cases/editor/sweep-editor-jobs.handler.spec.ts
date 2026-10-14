import { SweepEditorJobsHandler } from '../../../../../src/application/use-cases/editor/sweep-editor-jobs/sweep-editor-jobs.handler.js';
import { SweepEditorJobsCommand } from '../../../../../src/application/use-cases/editor/sweep-editor-jobs/sweep-editor-jobs.command.js';
import { aJob, jobContext } from '../../../../support/editor-job-fixtures.js';

describe('SweepEditorJobsHandler', () => {
  it('reports how many orphans the runner failed', async () => {
    const { jobs, runner, clock } = jobContext(); await jobs.insert(aJob({ createdAt: clock.now() }));
    expect(await new SweepEditorJobsHandler(runner).execute(new SweepEditorJobsCommand(false))).toEqual({ failed: 0 });
    expect(await new SweepEditorJobsHandler(runner).execute(new SweepEditorJobsCommand(true))).toEqual({ failed: 1 });
  });
});
