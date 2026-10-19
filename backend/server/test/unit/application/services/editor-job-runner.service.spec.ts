import { EditorJobRunnerService } from '../../../../src/application/services/editor-job-runner.service.js';
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
    expect(await jobs.find(a.id)).toMatchObject({ status: 'cancelled' });   // capabilities are revoked before cancel returns, even while the provider is unwinding
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
    expect(await boom.jobs.find(k.id)).toMatchObject({ status: 'failed', error: 'the editor job failed unexpectedly – try again' });
  });

  it('sweep expires only deadlines and preserves fresh work on boot', async () => {
    const { runner, jobs, clock, settingsRepo } = jobContext();
    await settingsRepo.upsert('editor_jobs_parallel', 0);
    const old = aJob({ status: 'running', startedAt: clock.now() }), fresh = aJob({ wallet: 'X', createdAt: clock.now() });
    await jobs.insert(old); await jobs.insert(fresh);
    expect(await runner.sweep()).toBe(0);
    clock.advance(601);
    await jobs.update(fresh.id, { status: 'queued' });
    expect(await runner.sweep()).toBe(2);
    expect((await jobs.find(old.id))!).toMatchObject({ status: 'failed', error: 'the server restarted or the job timed out' });
    const boot = jobContext(); const j = aJob({ createdAt: boot.clock.now() }); await boot.jobs.insert(j);
    await boot.settingsRepo.upsert('editor_jobs_parallel', 0);
    expect(await boot.runner.sweep()).toBe(0);
    expect((await boot.jobs.find(j.id))!.status).toBe('queued');
  });

  it('sweep drops a job queued HERE past the timeout (the editor paused); a long refusal is clipped to 300 characters', async () => {
    const { runner, jobs, clock, settingsRepo } = jobContext();
    await settingsRepo.upsert('editor_jobs_parallel', 0);
    const q = aJob({ createdAt: clock.now() }); await jobs.insert(q); runner.enqueue(q);
    expect(await runner.sweep()).toBe(0);
    clock.advance(601);
    expect(await runner.sweep()).toBe(1);
    expect(await jobs.find(q.id)).toMatchObject({ status: 'failed', error: 'the job waited longer than the timeout (the AI editor is paused or busy)' });
    await runner.settled(q.id);
    const r = jobContext(undefined, new ScriptedLlm([turn({ stop: 'refusal', detail: 'no '.repeat(400) })]));
    const j = aJob(); await r.jobs.insert(j); r.runner.enqueue(j); await r.runner.settled(j.id);
    expect((await r.jobs.find(j.id))!.error!.length).toBe(300);
  });
  it('independent runners share the global cap; another replica cancels the owner and queued work survives local shutdown', async () => {
    const c = jobContext();
    await c.settingsRepo.upsert('editor_jobs_parallel', 1);
    c.llm.turns.push(o => new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true })), turn({ text: 'recovered queue' }));
    const other = new EditorJobRunnerService(c.agent, c.jobs, c.settings, c.rules, c.clock);
    const a = aJob(), b = aJob({ wallet: 'X', entityId: 'rock' });
    await c.jobs.insert(a); await c.jobs.insert(b);
    c.runner.enqueue(a);
    await vi.waitFor(() => expect(c.llm.opened).toHaveLength(1));
    await other.sweep();
    expect(c.llm.opened).toHaveLength(1);
    expect(await other.cancel(a.id)).toBe(true);
    await c.settingsRepo.upsert('editor_jobs_parallel', 0);
    await c.runner.sweep();
    c.runner.onApplicationShutdown(); // queued DB row remains discoverable
    await c.runner.settled(a.id);
    await c.settingsRepo.upsert('editor_jobs_parallel', 1);
    await other.sweep();
    await other.settled(b.id);
    expect(c.llm.opened.filter(o => o.job?.entityId === 'rock')).toHaveLength(1);
    expect((await c.jobs.find(b.id))!.status).toBe('done');
    expect((await c.jobs.find(a.id))!.status).toBe('cancelled');
    other.onApplicationShutdown();
  });

  it('default capacity runs five generations, queues five more FIFO and refills every released slot', async () => {
    const c = jobContext();
    const release = new Map<string, () => void>();
    let active = 0, peak = 0;
    const started: string[] = [];
    for (let i = 0; i < 10; i++) c.llm.turns.push(async o => {
      const id = o.job!.entityId!;
      started.push(id); active++; peak = Math.max(peak, active);
      await new Promise<void>(resolve => release.set(id, resolve));
      active--; o.signal.throwIfAborted();
      return turn({ text: 'done' });
    });
    const rows = Array.from({ length: 10 }, (_, i) => aJob({ wallet: `W${i}`, entityId: `entity-${i}`, createdAt: new Date(c.clock.now().getTime() + i) }));
    for (const row of rows) {
      expect(await c.jobs.admit(row, new Date(0), 40)).toBe('accepted');
      c.runner.enqueue(row);
    }
    await vi.waitFor(() => expect(started).toHaveLength(5));
    expect((await c.jobs.open()).filter(j => j.status === 'queued')).toHaveLength(5);
    expect(started).toEqual(rows.slice(0, 5).map(j => j.entityId));
    for (let i = 0; i < 5; i++) {
      release.get(`entity-${i}`)!();
      await c.runner.settled(rows[i]!.id);
      await vi.waitFor(() => expect(started).toHaveLength(6 + i));
      expect(active).toBe(5);
    }
    expect(started).toEqual(rows.map(j => j.entityId));
    for (let i = 5; i < 10; i++) release.get(`entity-${i}`)!();
    await Promise.all(rows.map(j => c.runner.settled(j.id)));
    expect(peak).toBe(5);
    expect(active).toBe(0);
    expect((await c.jobs.list({ limit: 20 })).every(j => j.status === 'done')).toBe(true);
    c.runner.onApplicationShutdown();
  });

  it('shutdown drains a claim already in flight without calling the model', async () => {
    const c = jobContext();
    const row = aJob(); await c.jobs.insert(row);
    const claim = c.jobs.claim.bind(c.jobs);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(c.jobs, 'claim').mockImplementation(async (...args) => { await gate; return claim(...args); });
    c.runner.enqueue(row);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    const stopped = c.runner.onApplicationShutdown();
    release(); await stopped;
    expect(c.llm.opened).toEqual([]);
    expect((await c.jobs.find(row.id))!.status).toBe('failed');
    expect(c.runner.active().size).toBe(0);
  });

});
