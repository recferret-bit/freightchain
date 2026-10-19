import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ProcessReplayQueueCommand, type ReplayQueueProcessResult } from '../../application/use-cases/verdict/process-replay-queue/process-replay-queue.command.js';

const REPLAY_WORKER_INTERVAL_MS = 5_000;
const REPLAY_WORKER_BATCH = 12;
const REPLAY_WORKER_CONCURRENCY = 4;

/** Background worker loop that drains ReplayQueuePort across concurrent verification sessions.
    Registered in AppModule; overridden in the test harness so scenarios drive verification deterministically. */
@Injectable()
export class ReplayVerificationScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(ReplayVerificationScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly commands: CommandBus) {}

  get intervalMs(): number { return REPLAY_WORKER_INTERVAL_MS; }

  onApplicationBootstrap(): void {
    void this.run();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async run(): Promise<void> {
    try {
      const res = (await this.commands.execute(new ProcessReplayQueueCommand(REPLAY_WORKER_BATCH, REPLAY_WORKER_CONCURRENCY))) as ReplayQueueProcessResult;
      if (res.processed > 0 || res.failed > 0) {
        this.log.log({ event: 'replay-worker', msg: `verified ${res.processed} replay session(s)`, ...res });
      }
    } catch (error) {
      this.log.error(`replay verification worker pass failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), this.intervalMs);
    this.timer.unref();
  }
}
