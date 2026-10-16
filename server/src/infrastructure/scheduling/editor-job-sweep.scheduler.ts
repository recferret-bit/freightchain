import { rename, unlink, writeFile } from 'node:fs/promises';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { SweepEditorJobsCommand, type SweepEditorJobsResultDto } from '../../application/use-cases/editor/sweep-editor-jobs/sweep-editor-jobs.command.js';

export const EDITOR_SWEEP_MS = 1_000;
export const editorWorkerHealthPath = (pid = process.pid): string => `/tmp/fc-editor-worker-health-${pid}.json`;

/** Polls the shared PostgreSQL queue, expires deadlines and propagates cancellation every second. Startup preserves other replicas' live jobs.
    EditorWorkerModule only – the HTTP API and general CLI never claim AI jobs. */
@Injectable()
export class EditorJobSweepScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(EditorJobSweepScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly commands: CommandBus, private readonly clock: ClockPort) {}

  onApplicationBootstrap(): void {
    void this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.clearHealth();
  }

  private async clearHealth(): Promise<void> {
    await unlink(editorWorkerHealthPath()).catch(() => undefined);
  }

  async run(): Promise<void> {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      const { failed } = (await this.commands.execute(new SweepEditorJobsCommand())) as SweepEditorJobsResultDto;
      if (!this.stopped) {
        const file = editorWorkerHealthPath();
        await writeFile(`${file}.tmp`, JSON.stringify({ checkedAt: this.clock.now().getTime() }), { mode: 0o600 });
        if (this.stopped) await unlink(`${file}.tmp`).catch(() => undefined);
        else { await rename(`${file}.tmp`, file); if (this.stopped) await this.clearHealth(); }
      }
      if (failed > 0) this.log.log({ event: 'editor-sweep', msg: `failed ${failed} AI editor job(s) nobody runs`, failed });
    } catch {
      await this.clearHealth();
      this.log.error('editor job queue poll failed');
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), EDITOR_SWEEP_MS);
    // There is no HTTP listener in this process: the poll timer must keep an idle worker alive.
  }
}
