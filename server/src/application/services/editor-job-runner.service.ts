import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { clip, type EditorJobRecord } from '../../domain/editor/editor-job.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { EditorJobRepositoryPort } from '../ports/editor/editor-job.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { EditorAgentService } from './editor-agent.service.js';
import { GameSettingsService } from './game-settings.service.js';

/** PostgreSQL owns admission, queue, claims and terminal events. Local state only controls this process's provider calls.
 * A claim is never replayed: its startedAt + timeout is a fixed deadline, after which any replica fails it. */
@Injectable()
export class EditorJobRunnerService implements OnApplicationShutdown {
  private readonly log = new Logger('EditorJobs');
  private readonly running = new Map<string, AbortController>();
  private readonly done = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  private pumpTask: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly agent: EditorAgentService,
    private readonly jobs: EditorJobRepositoryPort,
    private readonly settings: GameSettingsService,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  active(): ReadonlySet<string> { return new Set(this.running.keys()); }

  /** Wakeup only. The committed row is the queue, so losing this call loses no work. */
  enqueue(job: EditorJobRecord): void {
    this.watch(job.id);
    void this.pump().catch(() => undefined);
  }

  async cancel(jobId: string): Promise<boolean> {
    const moved = await this.jobs.conclude(jobId, 'cancelled', null, this.clock.now());
    this.running.get(jobId)?.abort('cancel');
    if (!this.running.has(jobId)) this.settle(jobId);
    return moved;
  }

  settled(jobId: string): Promise<void> { return this.done.get(jobId)?.promise ?? Promise.resolve(); }

  private watch(jobId: string): void {
    if (this.done.has(jobId)) return;
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    this.done.set(jobId, { promise, resolve });
  }

  private settle(jobId: string): void { this.done.get(jobId)?.resolve(); this.done.delete(jobId); }

  private pump(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.pumpTask) return this.pumpTask;
    this.pumpTask = this.claimJobs().finally(() => { this.pumpTask = null; });
    return this.pumpTask;
  }

  private async claimJobs(): Promise<void> {
    try {
      const parallel = (await this.settings.current()).editorJobsParallel;
      while (!this.stopped && this.running.size < parallel) {
        const job = await this.jobs.claim(parallel, this.clock.now(), this.rules.get().editorJobTimeoutMs);
        if (!job) break;
        const c = new AbortController();
        if (this.stopped) c.abort('shutdown');
        this.watch(job.id);
        this.running.set(job.id, c);
        void this.start(job, c).catch(() => {
          // DB outages leave the durable claim for expiry, never for replay.
          this.log.error({ event: 'editor-job', msg: 'could not finalize editor job', jobId: job.id });
        }).finally(() => { this.running.delete(job.id); this.settle(job.id); void this.pump().catch(() => undefined); });
      }
    } catch {
      this.log.warn('could not claim editor work; the next poll will retry');
      throw new Error('could not claim editor work');
    }
  }

  private async start(job: EditorJobRecord, c: AbortController): Promise<void> {
    const remaining = job.startedAt!.getTime() + this.rules.get().editorJobTimeoutMs - this.clock.now().getTime();
    const timer = setTimeout(() => c.abort('timeout'), Math.max(0, remaining));
    timer.unref?.();
    try {
      if (remaining <= 0) c.abort('timeout');
      c.signal.throwIfAborted();
      const out = await this.agent.run(job, c.signal);
      c.signal.throwIfAborted();
      if (this.clock.now().getTime() >= job.startedAt!.getTime() + this.rules.get().editorJobTimeoutMs) throw new Error('expired');
      await this.jobs.conclude(job.id, out.status, out.status === 'done' ? null : clip(out.error, 300), this.clock.now());
    } catch {
      const cancel = c.signal.reason === 'cancel';
      const timed = c.signal.reason === 'timeout';
      if (!c.signal.aborted) this.log.error({ event: 'editor-job', msg: 'editor job failed unexpectedly', jobId: job.id });
      await this.jobs.conclude(job.id, cancel ? 'cancelled' : 'failed', cancel ? null : timed ? 'the job timed out (EDITOR_JOB_TIMEOUT_MS)' : 'the editor job failed unexpectedly – try again', this.clock.now());
    } finally { clearTimeout(timer); }
  }

  /** Also used at boot: another process's fresh claims must survive our startup. */
  async sweep(): Promise<number> {
    try {
      const failed = await this.jobs.expire(this.clock.now(), this.rules.get().editorJobTimeoutMs);
      for (const id of this.done.keys()) {
        const job = await this.jobs.find(id);
        if (!job || !['queued', 'running'].includes(job.status)) {
          this.running.get(id)?.abort(job?.status === 'cancelled' ? 'cancel' : 'closed');
          if (!this.running.has(id)) this.settle(id);
        }
      }
      await this.pump();
      return failed;
    } catch (e) {
      // No DB means no proof of a live capability. Abort local provider calls until storage returns.
      for (const c of this.running.values()) c.abort('storage');
      throw e;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    for (const c of this.running.values()) c.abort('shutdown');
    // The worker entrypoint calls this before closing Prisma, so terminal events can still commit.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await this.pumpTask?.catch(() => undefined);
          for (const c of this.running.values()) c.abort('shutdown');
          for (const id of this.done.keys()) if (!this.running.has(id)) this.settle(id);
          await Promise.allSettled([...this.done.values()].map(d => d.promise));
        })(),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 8_000); timer.unref?.(); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
}
