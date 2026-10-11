import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { MintAchievementsCommand, type MintPassDto } from '../../application/use-cases/achievements/mint-achievements/mint-achievements.command.js';
import { EnvService } from '../config/env.service.js';

/**
 * The badge mint job's schedule, registered in AppModule only (the admin CLI runs one pass with `achievement:mint`). On with ACHIEVEMENT_MINT_SECRET + tree +
 * collection + ACHIEVEMENT_MINT_INTERVAL_MS > 0: a pass on boot and then every interval, never two at once in this process (several instances are harmless: every
 * mint is CLAIMED in the database before its transaction goes out). A failed pass is logged; the next one starts over.
 */
@Injectable()
export class AchievementMintScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(AchievementMintScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly commands: CommandBus,
    private readonly env: EnvService,
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
    try {
      const pass = (await this.commands.execute(new MintAchievementsCommand(this.env.achievementMintDelayMs, this.env.achievementMintBatch))) as MintPassDto;
      if (pass.failed) this.log.warn(`achievement mint: ${pass.failed} badge(s) ran out of attempts – \`achievement:mint --retry\` after looking at the cause`);
    } catch (error) {
      this.log.error(`achievement mint pass failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), this.env.achievementMintIntervalMs);
    this.timer.unref(); // never keeps the process (or a test run) alive
  }
}
