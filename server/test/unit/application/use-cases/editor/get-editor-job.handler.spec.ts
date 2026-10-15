import { GetEditorJobHandler } from '../../../../../src/application/use-cases/editor/get-editor-job/get-editor-job.handler.js';
import { GetEditorJobQuery } from '../../../../../src/application/use-cases/editor/get-editor-job/get-editor-job.query.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { aJob, jobContext } from '../../../../support/editor-job-fixtures.js';

describe('GetEditorJobHandler', () => {
  it('a job as its DTO; an unknown id is a 404', async () => {
    const { jobs } = jobContext(), j = aJob(); await jobs.insert(j);
    expect(await new GetEditorJobHandler(jobs).execute(new GetEditorJobQuery('W', j.id))).toMatchObject({ id: j.id, status: 'queued', createdAt: j.createdAt.toISOString() });
    await expect(new GetEditorJobHandler(jobs).execute(new GetEditorJobQuery('W', '00000000-0000-4000-8000-0000000000ff'))).rejects.toBeInstanceOf(NotFoundError);
    await expect(new GetEditorJobHandler(jobs).execute(new GetEditorJobQuery('OTHER', j.id))).rejects.toBeInstanceOf(NotFoundError);
  });
});
