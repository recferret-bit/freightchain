import { Injectable, Logger, Optional, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { CachePort } from '../../application/ports/shared/cache.port.js';
import { CrankPoolsCommand, type CrankPassDto } from '../../application/use-cases/chain/crank-pools/crank-pools.command.js';
import { EnvService } from '../config/env.service.js';

const LOCK_KEY = 'sched:pool-crank';

/**
 * The pool crank's schedule, registered in AppModule only (the admin CLI runs one pass with `pool:crank`). On with CRANK_SECRET + a program + CRANK_INTERVAL_MS > 0:
 * a pass on boot and then every interval, coordinated across replicas via CachePort.tryLock when Redis is configured.
 */
@Injectable()
export class PoolCrankScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(PoolCrankScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly commands: CommandBus,
    private readonly env: EnvService,
    @Optional() private readonly cache?: CachePort,
  ) {}

  get enabled(): boolean { return !!this.env.crankSecret && !!this.env.ticketProgramId && this.env.crankIntervalMs > 0; }

  onApplicationBootstrap(): void {
    if (this.enabled) void this.run();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One pass, then arm the next. */
  async run(): Promise<void> {
    const ttl = Math.max(1000, Math.floor(this.env.crankIntervalMs * 0.8));
    if (!this.cache || await this.cache.tryLock(LOCK_KEY, ttl)) {
      try {
        const pass = (await this.commands.execute(new CrankPoolsCommand())) as CrankPassDto;
        const failed = pass.actions.filter((a) => a.error);
        if (failed.length) this.log.warn(`crank: ${failed.length} step(s) failed – retried next pass`);
      } catch (error) {
        await this.cache?.releaseLock(LOCK_KEY);
        this.log.error(`crank pass failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), this.env.crankIntervalMs);
    this.timer.unref(); // never keeps the process (or a test run) alive
  }
}
