import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { SweepTelemetryCommand, type SweepTelemetryResultDto } from '../../application/use-cases/telemetry/sweep-telemetry/sweep-telemetry.command.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import { DAY_MS, MINUTE_MS, nextUtcMidnight } from '../../domain/shared/time.js';

const OFFSET_MS = 30 * MINUTE_MS; // 00:30 UTC – clear of the free-ride grant at midnight
const RETRY_MS = 10 * MINUTE_MS;

/** Runs SweepTelemetryCommand on boot and every day at 00:30 UTC (same shape as DailyFreeRideScheduler: a plain timer, an idempotent command). */
@Injectable()
export class TelemetryRetentionScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(TelemetryRetentionScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly commands: CommandBus,
    private readonly clock: ClockPort,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async run(): Promise<void> {
    let delay: number;
    try {
      const { deleted, cutoff } = (await this.commands.execute(new SweepTelemetryCommand())) as SweepTelemetryResultDto;
      if (deleted > 0) this.log.log({ event: 'telemetry-sweep', msg: `deleted ${deleted} recording batches of rides ended before ${cutoff}`, deleted, cutoff });
      const now = this.clock.now();
      const today = nextUtcMidnight(now).getTime() - DAY_MS + OFFSET_MS;
      delay = (today > now.getTime() ? today : today + DAY_MS) - now.getTime();
    } catch (error) {
      this.log.error(`telemetry sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      delay = RETRY_MS;
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), delay);
    this.timer.unref();
  }
}
