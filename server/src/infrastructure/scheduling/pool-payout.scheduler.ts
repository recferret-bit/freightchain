import { Injectable, Logger, Optional, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { CachePort } from '../../application/ports/shared/cache.port.js';
import { PayPoolsCommand, type PayoutPassDto } from '../../application/use-cases/chain/pay-pools/pay-pools.command.js';
import { SyncPledgesCommand, type PledgeSyncDto } from '../../application/use-cases/pledges/sync-pledges/sync-pledges.command.js';
import { EnvService } from '../config/env.service.js';

const LOCK_KEY = 'sched:pool-payout';

/**
 * The payout job's schedule, registered in AppModule only (the admin CLI runs one pass with `pool:payout`). On with PAYOUT_SECRET + a program +
 * PAYOUT_INTERVAL_MS > 0: a pass on boot and then every interval, coordinated across replicas via CachePort.tryLock when Redis is configured.
 */
@Injectable()
export class PoolPayoutScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(PoolPayoutScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly commands: CommandBus,
    private readonly env: EnvService,
    @Optional() private readonly cache?: CachePort,
  ) {}

  get enabled(): boolean { return !!this.env.payoutSecret && !!this.env.ticketProgramId && this.env.payoutIntervalMs > 0; }

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
    const ttl = Math.max(1000, Math.floor(this.env.payoutIntervalMs * 0.8));
    if (!this.cache || await this.cache.tryLock(LOCK_KEY, ttl)) {
      try {
        const pass = (await this.commands.execute(new PayPoolsCommand())) as PayoutPassDto;
        const failed = pass.pools.filter((p) => p.state === 'error');
        if (failed.length) this.log.warn(`payout: ${failed.length} pool(s) failed – retried next pass (${failed.map((p) => `#${p.poolId}: ${p.note ?? ''}`).join('; ')})`);
      } catch (error) {
        await this.cache?.releaseLock(LOCK_KEY);
        this.log.error(`payout pass failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        const pledges = (await this.commands.execute(new SyncPledgesCommand())) as PledgeSyncDto;
        if (pledges.errors.length) this.log.warn(`pledges: ${pledges.errors.length} failed – retried next pass (${pledges.errors.map((e) => `${e.pledgeId}: ${e.note}`).join('; ')})`);
      } catch (error) {
        await this.cache?.releaseLock(LOCK_KEY);
        this.log.error(`pledge pass failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), this.env.payoutIntervalMs);
    this.timer.unref(); // never keeps the process (or a test run) alive
  }
}
