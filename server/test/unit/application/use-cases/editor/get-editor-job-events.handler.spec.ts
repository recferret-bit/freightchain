import { GetEditorJobEventsHandler } from '../../../../../src/application/use-cases/editor/get-editor-job-events/get-editor-job-events.handler.js';
import { GetEditorJobEventsQuery } from '../../../../../src/application/use-cases/editor/get-editor-job-events/get-editor-job-events.query.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { aJob, jobContext } from '../../../../support/editor-job-fixtures.js';

describe('GetEditorJobEventsHandler', () => {
  it('the status and the events after a seq; unknown job 404', async () => {
    const { jobs, clock } = jobContext(), j = aJob({ status: 'running' }); await jobs.insert(j);
    for (const t of ['status', 'text', 'tool_call'] as const) await jobs.appendEvent(j.id, t, { t }, clock.now());
    const r = await new GetEditorJobEventsHandler(jobs).execute(new GetEditorJobEventsQuery(j.id, 1));
    expect([r.status, r.events.map((e) => e.seq)]).toEqual(['running', [2, 3]]);
    await expect(new GetEditorJobEventsHandler(jobs).execute(new GetEditorJobEventsQuery('00000000-0000-4000-8000-0000000000ff', 0))).rejects.toBeInstanceOf(NotFoundError);
  });
});
