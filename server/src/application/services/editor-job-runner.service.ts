import { Injectable, Logger } from '@nestjs/common';
import { OPEN_STATUSES, clip, type EditorJobRecord, type JobStatus } from '../../domain/editor/editor-job.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { EditorJobRepositoryPort } from '../ports/editor/editor-job.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { EditorAgentService } from './editor-agent.service.js';
import { GameSettingsService } from './game-settings.service.js';

/**
 * The AI editor's in-process queue (the APP process – the worker never enqueues): at most `editor_jobs_parallel` jobs run at once, each with its own
 * AbortController (cancel, and EDITOR_JOB_TIMEOUT_MS). A job moves queued → running → done | failed | cancelled, each move a `status` event and the
 * last a `done` or `error` event. `sweep` fails jobs this process does not run (left by a restart) once they are past the timeout – or all of them on boot.
 */
@Injectable()
export class EditorJobRunnerService {
  private readonly log = new Logger('EditorJobs');
  private readonly queue: EditorJobRecord[] = [];
  private readonly running = new Map<string, AbortController>();
  /** resolves when a job is over – registered at enqueue (tests and shutdown wait on it) */
  private readonly done = new Map<string, { promise: Promise<void>; resolve: () => void }>();

  constructor(
    private readonly agent: EditorAgentService,
    private readonly jobs: EditorJobRepositoryPort,
    private readonly settings: GameSettingsService,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  /** ids this process is running or holding */
  active(): ReadonlySet<string> { return new Set([...this.running.keys(), ...this.queue.map((j) => j.id)]); }

  enqueue(job: EditorJobRecord): void {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    this.done.set(job.id, { promise, resolve });
    this.queue.push(job);
    void this.pump();
  }

  /** a queued job is dropped, a running one aborted; true when this process held it */
  async cancel(jobId: string): Promise<boolean> {
    const i = this.queue.findIndex((j) => j.id === jobId);
    if (i >= 0) { this.queue.splice(i, 1); await this.conclude(jobId, 'cancelled', null); this.settle(jobId); return true; }
    const c = this.running.get(jobId);
    if (c) { c.abort('cancel'); return true; }
    return false;
  }

  /** wait for a job this process started (tests) */
  settled(jobId: string): Promise<void> { return this.done.get(jobId)?.promise ?? Promise.resolve(); }

  private settle(jobId: string): void { this.done.get(jobId)?.resolve(); this.done.delete(jobId); }

  private async pump(): Promise<void> {
    let parallel = 0;
    try { parallel = (await this.settings.current()).editorJobsParallel; } catch (e) { this.log.warn(`could not read editor_jobs_parallel: ${e instanceof Error ? e.message : String(e)}`); return; }
    while (this.running.size < parallel && this.queue.length) {
      const job = this.queue.shift()!;
      const c = new AbortController();
      this.running.set(job.id, c);
      void this.start(job, c).finally(() => { this.running.delete(job.id); this.settle(job.id); void this.pump(); });
    }
  }

  private async start(job: EditorJobRecord, c: AbortController): Promise<void> {
    const timer = setTimeout(() => c.abort('timeout'), this.rules.get().editorJobTimeoutMs);
    timer.unref?.();
    try {
      if (!(await this.jobs.update(job.id, { status: 'running', startedAt: this.clock.now() }, ['queued']))) return;   // cancelled meanwhile
      await this.jobs.appendEvent(job.id, 'status', { status: 'running', provider: job.provider, model: job.model }, this.clock.now());
      const out = await this.agent.run(job, c.signal);
      if (out.status === 'done') await this.conclude(job.id, 'done', null);
      else await this.conclude(job.id, 'failed', out.error);
    } catch (e) {
      if (c.signal.aborted) await this.conclude(job.id, c.signal.reason === 'cancel' ? 'cancelled' : 'failed', c.signal.reason === 'cancel' ? null : 'the job timed out (EDITOR_JOB_TIMEOUT_MS)');
      else {
        const message = e instanceof Error ? e.message : String(e);
        this.log.error({ event: 'editor-job', msg: `job ${job.id} failed: ${message}`, jobId: job.id });
        await this.conclude(job.id, 'failed', clip(message, 300));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async conclude(jobId: string, status: JobStatus, why: string | null): Promise<void> {
    const error = why === null ? null : clip(why, 300);   // a refusal's detail is the model's own text
    if (!(await this.jobs.update(jobId, { status, error, finishedAt: this.clock.now() }, OPEN_STATUSES))) return;
    const at = this.clock.now();
    await this.jobs.appendEvent(jobId, 'status', { status }, at);
    await this.jobs.appendEvent(jobId, status === 'done' ? 'done' : 'error', status === 'done' ? { status } : { status, message: error ?? status }, at);
  }

  /** fail open jobs nobody runs: past the timeout, or every one of them (`all`, on boot – a restart killed them); jobs queued HERE past the timeout
   *  (the editor paused with editor_jobs_parallel 0) are dropped too; then the queue is pumped again (a raised editor_jobs_parallel takes effect) */
  async sweep(all: boolean): Promise<number> {
    const now = this.clock.now().getTime(), timeout = this.rules.get().editorJobTimeoutMs;
    let failed = 0;
    for (const j of this.queue.filter((q) => now - q.createdAt.getTime() >= timeout)) {
      this.queue.splice(this.queue.indexOf(j), 1);
      await this.conclude(j.id, 'failed', 'the job waited longer than the timeout (the AI editor is paused or busy)');
      this.settle(j.id);
      failed++;
    }
    void this.pump();
    const mine = this.active();
    for (const j of await this.jobs.open()) {
      if (mine.has(j.id)) continue;
      if (!all && now - (j.startedAt ?? j.createdAt).getTime() < timeout) continue;
      await this.conclude(j.id, 'failed', 'the server restarted or the job timed out');
      failed++;
    }
    return failed;
  }
}
