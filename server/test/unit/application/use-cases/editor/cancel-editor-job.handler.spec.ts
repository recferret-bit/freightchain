import { CancelEditorJobHandler } from '../../../../../src/application/use-cases/editor/cancel-editor-job/cancel-editor-job.handler.js';
import { CancelEditorJobCommand } from '../../../../../src/application/use-cases/editor/cancel-editor-job/cancel-editor-job.command.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { aJob, jobContext } from '../../../../support/editor-job-fixtures.js';

describe('CancelEditorJobHandler', () => {
  it('only the asking editor; an open job nobody here runs is cancelled in the table; a finished one stays as it is', async () => {
    const { jobs, clock } = jobContext(), h = new CancelEditorJobHandler(jobs, clock);
    const orphan = aJob({ status: 'running' }), done = aJob({ status: 'done' });
    await jobs.insert(orphan); await jobs.insert(done);
    await expect(h.execute(new CancelEditorJobCommand('X', orphan.id))).rejects.toBeInstanceOf(NotFoundError);
    expect(await h.execute(new CancelEditorJobCommand('W', orphan.id))).toEqual({ ok: true });
    expect((await jobs.find(orphan.id))!.status).toBe('cancelled');
    expect((await jobs.events(orphan.id, 0, 5)).map((e) => e.type)).toEqual(['status', 'error']);
    await h.execute(new CancelEditorJobCommand('W', done.id));
    expect((await jobs.find(done.id))!.status).toBe('done');
  });
});
