import { EditorJobsHttpController } from '../../../src/presentation/editor/editor-jobs.http.controller.js';
import { CreateEditorJobCommand } from '../../../src/application/use-cases/editor/create-editor-job/create-editor-job.command.js';
import { CancelEditorJobCommand } from '../../../src/application/use-cases/editor/cancel-editor-job/cancel-editor-job.command.js';
import { ListEditorJobsQuery } from '../../../src/application/use-cases/editor/list-editor-jobs/list-editor-jobs.query.js';
import { GetEditorJobQuery } from '../../../src/application/use-cases/editor/get-editor-job/get-editor-job.query.js';
import { GetEditorJobEventsQuery } from '../../../src/application/use-cases/editor/get-editor-job-events/get-editor-job-events.query.js';
import { createJobBodySchema, jobEventsQuerySchema } from '../../../src/presentation/editor/dto/editor.dto.js';
import { busMock } from '../../support/bus.js';

const W = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn', J = '00000000-0000-4000-8000-000000000001', R = '00000000-0000-4000-8000-000000000002';

describe('EditorJobsHttpController', () => {
  it('dispatches every route with the editor wallet', async () => {
    const commands = busMock({ jobId: J }), queries = busMock([]);
    const c = new EditorJobsHttpController(commands.bus, queries.bus), me = { wallet: W };
    await c.create(me, createJobBodySchema.parse({ prompt: ' taller ', entityId: 'cactus', baseRevisionId: R, provider: 'anthropic' }));
    expect(commands.last()).toEqual(new CreateEditorJobCommand(W, 'taller', 'cactus', R, 'anthropic', undefined));
    await c.create(me, createJobBodySchema.parse({ prompt: 'a crate' })); expect(commands.last()).toEqual(new CreateEditorJobCommand(W, 'a crate', null, undefined, undefined, undefined));
    await c.list({ entityId: 'cactus' }); expect(queries.last()).toEqual(new ListEditorJobsQuery('cactus'));
    await c.list({}); expect(queries.last()).toEqual(new ListEditorJobsQuery(null));
    await c.job({ id: J }); expect(queries.last()).toEqual(new GetEditorJobQuery(J));
    await c.events({ id: J }, jobEventsQuerySchema.parse({ after: '4' })); expect(queries.last()).toEqual(new GetEditorJobEventsQuery(J, 4));
    await c.cancel(me, { id: J }); expect(commands.last()).toEqual(new CancelEditorJobCommand(W, J));
  });

  it('a prompt is 1–4000 characters; baseRevisionId null is kept, omitted is undefined', () => {
    expect(createJobBodySchema.safeParse({ prompt: '' }).success).toBe(false);
    expect(createJobBodySchema.safeParse({ prompt: 'x'.repeat(4001) }).success).toBe(false);
    expect(createJobBodySchema.parse({ prompt: 'x', baseRevisionId: null }).baseRevisionId).toBeNull();
    expect(createJobBodySchema.parse({ prompt: 'x' }).baseRevisionId).toBeUndefined();
  });
});
