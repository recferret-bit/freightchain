import { McpSaveDraftHandler } from '../../../../../src/application/use-cases/editor/mcp-save-draft/mcp-save-draft.handler.js';
import { McpSaveDraftCommand } from '../../../../../src/application/use-cases/editor/mcp-save-draft/mcp-save-draft.command.js';
import { printSource } from '../../../../../src/domain/shared/entity.js';
import { ForbiddenError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { aJob, jobContext } from '../../../../support/editor-job-fixtures.js';
import { fatCactus, seedEntity } from '../../../../support/entity-fixtures.js';

describe('McpSaveDraftHandler', () => {
  const setup = async (entityId: string | null = 'cactus') => {
    const c = jobContext(), job = aJob({ status: 'running', entityId, wallet: 'ED' }); await c.jobs.insert(job);
    return { ...c, job, h: new McpSaveDraftHandler(c.jobs, c.write, c.catalog, c.clock, c.transactions) };
  };

  it('a draft of the job\'s model on the head as it is now: authored by the job\'s wallet, with its id; a draft event and the job\'s result', async () => {
    const { h, job, jobs } = await setup();
    const r1 = await h.execute(new McpSaveDraftCommand(job.id, 'cactus', fatCactus(), 'fatter'));
    expect(r1).toMatchObject({ seq: 2, authorWallet: 'ED', jobId: job.id, message: 'fatter' });
    const r2 = await h.execute(new McpSaveDraftCommand(job.id, 'cactus', fatCactus(0.5), ''));   // on the new head, no base needed
    expect(r2).toMatchObject({ seq: 3, parentId: r1.id, message: 'AI: taller' });
    expect((await jobs.find(job.id))!.resultRevisionId).toBe(r2.id);
    expect((await jobs.events(job.id, 0, 10)).map((e) => e.payload)).toEqual([{ revisionId: r1.id, entityId: 'cactus', seq: 2 }, { revisionId: r2.id, entityId: 'cactus', seq: 3 }]);
  });

  it('scope: another existing entity is a 403 job_scope; a new part is fine; a job without an entity may only create; unknown job 404', async () => {
    const { h, job } = await setup();
    await expect(h.execute(new McpSaveDraftCommand(job.id, 'rock', printSource(seedEntity('rock')), 'm'))).rejects.toBeInstanceOf(ForbiddenError);
    const part = printSource({ id: 'job-crate', kind: 'part', v: 1, slots: { m: {} }, parts: [{ geo: 'box', mat: 'm', s: [1, 1, 1], at: [0, 0.5, 0] }] });
    await expect(h.execute(new McpSaveDraftCommand(job.id, 'job-crate', part, 'crate'))).resolves.toMatchObject({ seq: 1 });
    const free = await setup(null);
    await expect(free.h.execute(new McpSaveDraftCommand(free.job.id, 'rock', printSource({ ...seedEntity('rock'), note: 'x' }), 'm'))).rejects.toMatchObject({ errorCode: 'job_scope' });
    const mine = printSource({ ...seedEntity('rock'), id: 'job-rock', note: 'mine' });
    await expect(free.h.execute(new McpSaveDraftCommand(free.job.id, 'job-rock', mine, 'm'))).resolves.toMatchObject({ entityId: 'job-rock', seq: 1 });
    await expect(free.h.execute(new McpSaveDraftCommand(free.job.id, 'job-rock', mine.replace('mine', 'again'), 'm'))).resolves.toMatchObject({ entityId: 'job-rock', seq: 2 });
    await expect(h.execute(new McpSaveDraftCommand('00000000-0000-4000-8000-0000000000ff', 'cactus', fatCactus(), 'm'))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('the new-entity cap counts drafts past the first page of events', async () => {
    const { h, job, jobs, clock } = await setup(null);
    for (let i = 0; i < 500; i++) await jobs.appendEvent(job.id, 'status', { i }, clock.now());
    const part = (id: string) => printSource({ id, kind: 'part', v: 1, slots: { m: {} }, parts: [{ geo: 'box', mat: 'm', s: [1, 1, 1], at: [0, 0.5, 0] }] });
    for (const id of ['a-part', 'b-part', 'c-part', 'd-part']) await h.execute(new McpSaveDraftCommand(job.id, id, part(id), 'm'));
    await expect(h.execute(new McpSaveDraftCommand(job.id, 'e-part', part('e-part'), 'm'))).rejects.toMatchObject({ errorCode: 'job_scope' });
  });
});
