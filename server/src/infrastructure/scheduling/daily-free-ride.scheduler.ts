import { Injectable, Logger, Optional, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { GrantDailyFreeRidesCommand, type GrantDailyFreeRidesResultDto } from '../../application/use-cases/players/grant-daily-free-rides/grant-daily-free-rides.command.js';
import { CachePort } from '../../application/ports/shared/cache.port.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import { SECOND_MS, nextUtcMidnight } from '../../domain/shared/time.js';

const MARGIN_MS = SECOND_MS; // timers can fire a hair early – land safely on the new UTC day
const RETRY_MS = 60 * SECOND_MS;
const LOCK_KEY = 'sched:daily-free-ride';

/**
 * The 00:00 UTC cron: dispatches GrantDailyFreeRidesCommand on boot (catches up a midnight the server slept through) and then at every UTC midnight.
 * Coordinated across replicas via CachePort.tryLock when Redis is configured.
 */
@Injectable()
export class DailyFreeRideScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(DailyFreeRideScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly commands: CommandBus,
    private readonly clock: ClockPort,
    @Optional() private readonly cache?: CachePort,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One grant, then arm the next midnight (a failed grant is retried in a minute, not at the next midnight). */
  async run(): Promise<void> {
    let delay: number;
    try {
      if (!this.cache || await this.cache.tryLock(LOCK_KEY, 30 * SECOND_MS)) {
        const { day, players } = (await this.commands.execute(new GrantDailyFreeRidesCommand())) as GrantDailyFreeRidesResultDto;
        if (players > 0) this.log.log(`daily free ride for ${day}: ${players} players`);
      }
      const now = this.clock.now();
      delay = nextUtcMidnight(now).getTime() - now.getTime() + MARGIN_MS;
    } catch (error) {
      await this.cache?.releaseLock(LOCK_KEY);
      this.log.error(`daily free ride grant failed: ${error instanceof Error ? error.message : String(error)}`);
      delay = RETRY_MS;
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), delay);
    this.timer.unref(); // never keeps the process (or a test run) alive
  }
}
