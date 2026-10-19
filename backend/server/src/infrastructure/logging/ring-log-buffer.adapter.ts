import { Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { LogBufferPort } from '../../application/ports/ops/log-buffer.port.js';
import type { LogEntry, LogFilter } from '../../domain/ops/log-entry.js';
import { EnvService } from '../config/env.service.js';
import { LOG_RING_SIZE, LogRing, matchesLogFilter } from './log-ring.js';

const REDIS_LOGS_KEY = 'fc:ops:logs';
const PUSH_LUA = `
redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[2]) - 1)
return 1
`;

@Injectable()
export class RingLogBufferAdapter extends LogBufferPort implements OnModuleDestroy {
  private readonly redis: Redis | null = null;

  constructor(
    private readonly ring: LogRing,
    @Optional() env?: EnvService,
  ) {
    super();
    if (env?.redisUrl) {
      this.redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 300 });
      this.redis.on('error', () => undefined);
      this.ring.onPush((entry) => {
        void this.redis?.eval(PUSH_LUA, 1, REDIS_LOGS_KEY, JSON.stringify(entry), String(LOG_RING_SIZE)).catch(() => undefined);
      });
    }
  }

  recent(filter: LogFilter): LogEntry[] | Promise<LogEntry[]> {
    if (!this.redis) return this.ring.recent(filter);
    return this.recentFromRedis(filter);
  }

  async onModuleDestroy(): Promise<void> {
    this.ring.onPush(null);
    await this.redis?.quit().catch(() => undefined);
  }

  private async recentFromRedis(filter: LogFilter): Promise<LogEntry[]> {
    try {
      const raw = await this.redis!.lrange(REDIS_LOGS_KEY, 0, LOG_RING_SIZE - 1);
      if (!raw.length) return this.ring.recent(filter);
      const out: LogEntry[] = [];
      const needle = filter.text?.toLowerCase();
      for (const item of raw) {
        if (out.length >= filter.limit) break;
        const entry = JSON.parse(item) as LogEntry;
        if (matchesLogFilter(entry, filter, needle)) out.push(entry);
      }
      return out;
    } catch {
      return this.ring.recent(filter);
    }
  }
}
