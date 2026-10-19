import { CreateEditorJobHandler } from '../../../../../src/application/use-cases/editor/create-editor-job/create-editor-job.handler.js';
import { CreateEditorJobCommand } from '../../../../../src/application/use-cases/editor/create-editor-job/create-editor-job.command.js';
import { BadRequestError, ConflictError, ServiceUnavailableError, TooManyRequestsError, UnprocessableEntityError } from '../../../../../src/domain/shared/errors.js';
import { ScriptedLlm, ScriptedMcp, aJob, jobContext, turn } from '../../../../support/editor-job-fixtures.js';
import { fatCactus } from '../../../../support/entity-fixtures.js';

const setup = (llm = new ScriptedLlm([turn()]), mcp = new ScriptedMcp()) => {
  const c = jobContext(undefined, llm, mcp);
  return { ...c, h: new CreateEditorJobHandler(c.jobs, llm, mcp, c.catalog, c.settings, c.entropy, c.clock) };
};
const cmd = (over: Partial<{ wallet: string; prompt: string; entityId: string | null; base: string | null | undefined; provider: string; model: string }> = {}) =>
  new CreateEditorJobCommand(over.wallet ?? 'W', over.prompt ?? 'taller', over.entityId === undefined ? 'cactus' : over.entityId, over.base, over.provider, over.model);

describe('CreateEditorJobHandler (the bridge\'s gate)', () => {
  it('a valid request becomes a queued job (provider / model chosen) and runs', async () => {
    const { h, jobs, runner } = setup();
    const { jobId } = await h.execute(cmd());
    expect(await jobs.find(jobId)).toMatchObject({ wallet: 'W', provider: 'fake', model: 'scripted', entityId: 'cactus', status: expect.stringMatching(/queued|running|done/) });
    expect((await jobs.find(jobId))!.status).toBe('queued');
    await runner.sweep();
    await runner.settled(jobId);
    expect((await jobs.find(jobId))!.status).toBe('done');
    expect((await jobs.events(jobId, 0, 5))[0]).toMatchObject({ type: 'status', payload: { status: 'queued' } });
  });

  it('refusals in order: MCP off 503, unknown provider / model 400, stale base 409, daily cap 429, an open job 409, the spec gate 422 – none stores a job', async () => {
    const off = new ScriptedMcp(); off.configured = false;
    await expect(setup(undefined, off).h.execute(cmd())).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(setup().h.execute(cmd({ provider: 'openai' }))).rejects.toBeInstanceOf(BadRequestError);
    await expect(setup().h.execute(cmd({ model: 'gpt-6' }))).rejects.toMatchObject({ errorCode: 'bad_provider' });
    const s = setup();
    await s.write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: '', baseRevisionId: null, author: 'W' });
    await expect(s.h.execute(cmd({ base: null }))).rejects.toMatchObject({ errorCode: 'stale_base' });
    const cap = setup(); await cap.settingsRepo.upsert('editor_jobs_per_day', 1); await cap.jobs.insert(aJob({ status: 'done', createdAt: cap.clock.now() }));
    await expect(cap.h.execute(cmd())).rejects.toBeInstanceOf(TooManyRequestsError);
    const busy = setup(); await busy.jobs.insert(aJob({ wallet: 'X', entityId: 'cactus', status: 'running', createdAt: busy.clock.now() }));
    await expect(busy.h.execute(cmd())).rejects.toBeInstanceOf(ConflictError);
    await expect(busy.h.execute(cmd({ entityId: 'rock' }))).resolves.toHaveProperty('jobId');   // another editor's job on another model is fine
    const spec = new ScriptedMcp(); spec.verdict = { verdict: 'rejected', kind: 'car', errors: ['car wheels must be 4; got 2'] };
    const g = setup(new ScriptedLlm(), spec);
    await expect(g.h.execute(cmd({ prompt: 'a car with 2 wheels' }))).rejects.toMatchObject({ errorCode: 'spec_invalid', errors: ['car wheels must be 4; got 2'] });
    await expect(g.h.execute(cmd({ prompt: 'a car with 2 wheels' }))).rejects.toBeInstanceOf(UnprocessableEntityError);
    expect(await g.jobs.list({ limit: 10 })).toEqual([]);
    expect(g.llm.opened).toEqual([]);
  });

  it('two requests of one wallet at the same moment: exactly one job, the other is job_running (no await between the check and the claim)', async () => {
    const { h, jobs, runner } = setup(new ScriptedLlm([turn(), turn()]));
    const results = await Promise.allSettled([h.execute(cmd()), h.execute(cmd({ entityId: 'rock' }))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { errorCode: 'job_running' } });
    const [job] = await jobs.list({ limit: 10 }); await runner.sweep(); await runner.settled(job!.id);
    await expect(h.execute(cmd({ entityId: 'rock' }))).resolves.toHaveProperty('jobId');   // the claim is released once the job row exists / ended
  });
});
