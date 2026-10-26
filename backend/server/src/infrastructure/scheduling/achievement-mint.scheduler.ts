import { Injectable, Logger, Optional, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { CachePort } from '../../application/ports/shared/cache.port.js';
import { MintAchievementsCommand, type MintPassDto } from '../../application/use-cases/achievements/mint-achievements/mint-achievements.command.js';
import { EnvService } from '../config/env.service.js';

const LOCK_KEY = 'sched:achievement-mint';

/**
 * The badge mint job's schedule, registered in AppModule only (the admin CLI runs one pass with `achievement:mint`). On with ACHIEVEMENT_MINT_SECRET + tree +
 * collection + ACHIEVEMENT_MINT_INTERVAL_MS > 0: a pass on boot and then every interval, coordinated across replicas via CachePort.tryLock when Redis is configured.
 */
@Injectable()
export class AchievementMintScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(AchievementMintScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly commands: CommandBus,
    private readonly env: EnvService,
    @Optional() private readonly cache?: CachePort,
  ) {}

  get enabled(): boolean { return !!this.env.achievementMintSecret && !!this.env.achievementTree && !!this.env.achievementCollection && this.env.achievementMintIntervalMs > 0; }

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
    if (this.stopped) return;
    const ttl = Math.max(1000, Math.floor(this.env.achievementMintIntervalMs * 0.8));
    let locked = false;
    try {
      if (!this.cache || (locked = await this.cache.tryLock(LOCK_KEY, ttl))) {
        const pass = (await this.commands.execute(new MintAchievementsCommand(this.env.achievementMintDelayMs, this.env.achievementMintBatch))) as MintPassDto;
        if (pass.failed) this.log.warn(`achievement mint: ${pass.failed} badge(s) ran out of attempts – \`achievement:mint --retry\` after looking at the cause`);
      }
    } catch (error) {
      if (locked) await this.cache?.releaseLock(LOCK_KEY).catch(() => undefined);
      this.log.error({ event: 'achievement-mint.failed', message: error instanceof Error ? error.name : 'unknown' });
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), this.env.achievementMintIntervalMs);
    this.timer.unref(); // never keeps the process (or a test run) alive
  }
}
