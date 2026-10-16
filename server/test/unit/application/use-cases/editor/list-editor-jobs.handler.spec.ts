import { ListEditorJobsHandler } from '../../../../../src/application/use-cases/editor/list-editor-jobs/list-editor-jobs.handler.js';
import { ListEditorJobsQuery } from '../../../../../src/application/use-cases/editor/list-editor-jobs/list-editor-jobs.query.js';
import { aJob, jobContext } from '../../../../support/editor-job-fixtures.js';

describe('ListEditorJobsHandler', () => {
  it('newest first, of one entity when asked', async () => {
    const { jobs } = jobContext();
    await jobs.insert(aJob({ entityId: 'cactus', createdAt: new Date(1000) })); await jobs.insert(aJob({ entityId: 'rock', createdAt: new Date(2000) })); await jobs.insert(aJob({ entityId: 'cactus', createdAt: new Date(3000) }));
    const h = new ListEditorJobsHandler(jobs);
    expect((await h.execute(new ListEditorJobsQuery('W', null))).map((j) => j.entityId)).toEqual(['cactus', 'rock', 'cactus']);
    expect((await h.execute(new ListEditorJobsQuery('W', 'cactus'))).map((j) => j.createdAt)).toEqual([new Date(3000).toISOString(), new Date(1000).toISOString()]);
    await jobs.insert(aJob({ wallet: 'OTHER', entityId: 'rock', createdAt: new Date(4000) }));
    expect(await h.execute(new ListEditorJobsQuery('OTHER', null))).toHaveLength(1);
    expect(await h.execute(new ListEditorJobsQuery('W', null))).toHaveLength(3);
  });
});
