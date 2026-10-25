import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ReleaseConvoyCommand } from './release-convoy.command.js';
import { ConvoyService, type ConvoyExpiryDto } from './convoy.service.js';

/** Deletes pending convoy rows past 72h and expires active rows past 60d without M1. The legacy gift sweeper is a different service. */
@Injectable()
export class ReferralExpiryScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(ReferralExpiryScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly convoy: ConvoyService, private readonly commands: CommandBus) {}

  get intervalMs(): number { return 60_000; }

  async sweep(): Promise<ConvoyExpiryDto> {
    const expired = await this.convoy.expireDue();
    await this.commands.execute(new ReleaseConvoyCommand());
    return expired;
  }

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
      const expired = await this.sweep();
      if (expired.deletedPending > 0 || expired.expiredActive > 0) {
        this.log.log({ event: 'convoy-expire', msg: `deleted ${expired.deletedPending} pending, expired ${expired.expiredActive} active`, ...expired });
      }
    } catch (error) {
      this.log.error(`convoy expiry failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), this.intervalMs);
    this.timer.unref();
  }
}
