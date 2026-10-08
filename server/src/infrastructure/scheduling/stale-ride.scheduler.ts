import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { SweepStaleRidesCommand, type SweepStaleRidesResultDto } from '../../application/use-cases/rides/sweep-stale-rides/sweep-stale-rides.command.js';
import { RulesConfigPort } from '../../application/ports/config/rules-config.port.js';

/** Runs SweepStaleRidesCommand on boot and then every min(30 s, HB_TIMEOUT_MS / 3) – an abandoned ride (silent for the timeout) is ended within one interval after.
    A plain timer and an idempotent command (same shape as TelemetryRetentionScheduler); AppModule only – the admin CLI boots without timers. */
@Injectable()
export class StaleRideScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(StaleRideScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly commands: CommandBus,
    private readonly rules: RulesConfigPort,
  ) {}

  get intervalMs(): number { return Math.min(30_000, Math.floor(this.rules.get().hbTimeoutMs / 3)); }

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
      const { ended } = (await this.commands.execute(new SweepStaleRidesCommand())) as SweepStaleRidesResultDto;
      if (ended > 0) this.log.log({ event: 'stale-sweep', msg: `ended ${ended} ride(s) whose tab vanished (failed · heartbeat lost)`, ended });
    } catch (error) {
      this.log.error(`stale ride sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), this.intervalMs);
    this.timer.unref();
  }
}
