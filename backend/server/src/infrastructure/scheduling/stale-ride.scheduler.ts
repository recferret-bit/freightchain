import { Injectable, Logger, Optional, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { SweepStaleRidesCommand, type SweepStaleRidesResultDto } from '../../application/use-cases/rides/sweep-stale-rides/sweep-stale-rides.command.js';
import { RulesConfigPort } from '../../application/ports/config/rules-config.port.js';
import { CachePort } from '../../application/ports/shared/cache.port.js';

const LOCK_KEY = 'sched:stale-rides';

/** Runs SweepStaleRidesCommand on boot and then every min(30 s, HB_TIMEOUT_MS / 3) – an abandoned ride (silent for the timeout) is ended within one interval after.
    Coordinated across replicas via CachePort.tryLock when Redis is configured; AppModule only – the admin CLI boots without timers. */
@Injectable()
export class StaleRideScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(StaleRideScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly commands: CommandBus,
    private readonly rules: RulesConfigPort,
    @Optional() private readonly cache?: CachePort,
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
    if (this.stopped) return;
    const ttl = Math.max(1000, Math.floor(this.intervalMs * 0.8));
    let locked = false;
    try {
      if (!this.cache || (locked = await this.cache.tryLock(LOCK_KEY, ttl))) {
        const { ended } = (await this.commands.execute(new SweepStaleRidesCommand())) as SweepStaleRidesResultDto;
        if (ended > 0) this.log.log({ event: 'stale-sweep', msg: `ended ${ended} ride(s) whose tab vanished (failed · heartbeat lost)`, ended });
      }
    } catch (error) {
      if (locked) await this.cache?.releaseLock(LOCK_KEY).catch(() => undefined);
      this.log.error({ event: 'stale-sweep.failed', message: error instanceof Error ? error.name : 'unknown' });
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), this.intervalMs);
    this.timer.unref();
  }
}
