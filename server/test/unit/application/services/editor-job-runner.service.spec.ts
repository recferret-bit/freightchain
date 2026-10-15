import { ScriptedLlm, aJob, jobContext, turn } from '../../../support/editor-job-fixtures.js';
import { unitRules } from '../../../support/unit-context.js';

describe('EditorJobRunnerService', () => {
  it('queued → running → done, each a status event, the last a done event', async () => {
    const { runner, jobs } = jobContext(undefined, new ScriptedLlm([turn({ text: 'ok' })]));
    const job = aJob(); await jobs.insert(job);
    runner.enqueue(job); await runner.settled(job.id);
    expect((await jobs.find(job.id))!.status).toBe('done');
    const ev = await jobs.events(job.id, 0, 50);
    expect(ev.filter((e) => e.type === 'status').map((e) => e.payload['status'])).toEqual(['running', 'done']);
    expect(ev.at(-1)!.type).toBe('done');
  });

  it('at most editor_jobs_parallel run at once; a queued job is cancelled without running; a running one is aborted (cancelled)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const llm = new ScriptedLlm([async (o) => { await gate; o.signal.throwIfAborted(); return turn(); }, turn()]);
    const { runner, jobs, settingsRepo } = jobContext(undefined, llm);
    await settingsRepo.upsert('editor_jobs_parallel', 1);
    const a = aJob(), b = aJob({ wallet: 'X', entityId: 'rock' }); await jobs.insert(a); await jobs.insert(b);
    runner.enqueue(a); runner.enqueue(b);
    await new Promise((r) => setTimeout(r, 10));
    expect([(await jobs.find(a.id))!.status, (await jobs.find(b.id))!.status]).toEqual(['running', 'queued']);
    expect(await runner.cancel(b.id)).toBe(true);
    expect((await jobs.find(b.id))!.status).toBe('cancelled');
    expect(await runner.cancel(a.id)).toBe(true);
    release(); await runner.settled(a.id);
    expect((await jobs.find(a.id))!).toMatchObject({ status: 'cancelled', error: null });
    expect(await runner.cancel('00000000-0000-4000-8000-0000000000ff')).toBe(false);
  });

  it('a job over EDITOR_JOB_TIMEOUT_MS is aborted and failed; a crash is a failed job with the message', async () => {
    const slow = new ScriptedLlm([(o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted'))))]);
    const t = jobContext(unitRules({ editorJobTimeoutMs: 20 }), slow);
    const j = aJob(); await t.jobs.insert(j); t.runner.enqueue(j); await t.runner.settled(j.id);
    expect(await t.jobs.find(j.id)).toMatchObject({ status: 'failed', error: 'the job timed out (EDITOR_JOB_TIMEOUT_MS)' });
    const boom = jobContext(undefined, new ScriptedLlm([]));
    const k = aJob(); await boom.jobs.insert(k); boom.runner.enqueue(k); await boom.runner.settled(k.id);
    expect(await boom.jobs.find(k.id)).toMatchObject({ status: 'failed', error: 'no scripted turn left' });
  });

  it('sweep: open jobs nobody here runs – past the timeout, or all of them on boot', async () => {
    const { runner, jobs, clock } = jobContext();
    const old = aJob({ status: 'running', startedAt: clock.now() }), fresh = aJob({ wallet: 'X', createdAt: clock.now() });
    await jobs.insert(old); await jobs.insert(fresh);
    expect(await runner.sweep(false)).toBe(0);
    clock.advance(601);
    await jobs.update(fresh.id, { status: 'queued' });
    expect(await runner.sweep(false)).toBe(2);
    expect((await jobs.find(old.id))!).toMatchObject({ status: 'failed', error: 'the server restarted or the job timed out' });
    const boot = jobContext(); const j = aJob({ createdAt: boot.clock.now() }); await boot.jobs.insert(j);
    expect(await boot.runner.sweep(true)).toBe(1);
  });

  it('sweep drops a job queued HERE past the timeout (the editor paused); a long refusal is clipped to 300 characters', async () => {
    const { runner, jobs, clock, settingsRepo } = jobContext();
    await settingsRepo.upsert('editor_jobs_parallel', 0);
    const q = aJob({ createdAt: clock.now() }); await jobs.insert(q); runner.enqueue(q);
    expect(await runner.sweep(false)).toBe(0);
    clock.advance(601);
    expect(await runner.sweep(false)).toBe(1);
    expect(await jobs.find(q.id)).toMatchObject({ status: 'failed', error: 'the job waited longer than the timeout (the AI editor is paused or busy)' });
    await runner.settled(q.id);
    const r = jobContext(undefined, new ScriptedLlm([turn({ stop: 'refusal', detail: 'no '.repeat(400) })]));
    const j = aJob(); await r.jobs.insert(j); r.runner.enqueue(j); await r.runner.settled(j.id);
    expect((await r.jobs.find(j.id))!.error!.length).toBe(300);
  });
});
