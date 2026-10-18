import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ReleaseHonkCommand } from '../../application/use-cases/honk/release-honk.command.js';

/** Credits 8h TEN4 once the 48h hold has passed. A plain timer (same shape as StaleRideScheduler); AppModule only. */
@Injectable()
export class HonkReleaseScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(HonkReleaseScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly commands: CommandBus) {}

  get intervalMs(): number { return 60_000; }

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
      const released = (await this.commands.execute(new ReleaseHonkCommand())) as number;
      if (released > 0) this.log.log({ event: 'honk-release', msg: `credited ${released} held TEN4 mint(s)`, released });
    } catch (error) {
      this.log.error(`TEN4 release failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), this.intervalMs);
    this.timer.unref();
  }
}
