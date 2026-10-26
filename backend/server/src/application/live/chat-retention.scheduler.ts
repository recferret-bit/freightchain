import { Injectable, Logger, Optional, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CachePort } from '../ports/shared/cache.port.js';
import { LiveChatService } from './live-chat.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_KEY = 'sched:chat-retention';

/** Deletes replay chat older than 90 days. Tip rows are donations and are kept. Runs on boot and once a day. */
@Injectable()
export class ChatRetentionScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(ChatRetentionScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly chat: LiveChatService,
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

  async run(): Promise<number> {
    let deleted = 0;
    let locked = false;
    try {
      if (!this.cache || (locked = await this.cache.tryLock(LOCK_KEY, 5 * 60 * 1000))) {
        deleted = await this.chat.purge();
        if (deleted > 0) this.log.log({ event: 'chat-retention', msg: `deleted ${deleted} chat lines older than 90 days`, deleted });
      }
    } catch (error) {
      if (locked) await this.cache?.releaseLock(LOCK_KEY).catch(() => undefined);
      this.log.error(`chat retention failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.run(), DAY_MS);
      this.timer.unref();
    }
    return deleted;
  }
}
