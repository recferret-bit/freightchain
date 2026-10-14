import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { SweepEditorJobsCommand, type SweepEditorJobsResultDto } from '../../application/use-cases/editor/sweep-editor-jobs/sweep-editor-jobs.command.js';

export const EDITOR_SWEEP_MS = 60_000;

/** Fails AI editor jobs nobody runs: on boot every open job (the last process died with them), then every minute those past EDITOR_JOB_TIMEOUT_MS.
    AppModule only – the worker and the CLI boot without it (they never run jobs). */
@Injectable()
export class EditorJobSweepScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(EditorJobSweepScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly commands: CommandBus) {}

  onApplicationBootstrap(): void {
    void this.run(true);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async run(all = false): Promise<void> {
    try {
      const { failed } = (await this.commands.execute(new SweepEditorJobsCommand(all))) as SweepEditorJobsResultDto;
      if (failed > 0) this.log.log({ event: 'editor-sweep', msg: `failed ${failed} AI editor job(s) nobody runs`, failed });
    } catch (error) {
      this.log.error(`editor job sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), EDITOR_SWEEP_MS);
    this.timer.unref();
  }
}
