import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CachePort } from '../../application/ports/shared/cache.port.js';
import type { ClockPort } from '../../application/ports/shared/clock.port.js';

const KEY_PREFIX = 'fc:';
const COMMAND_TIMEOUT_MS = 300;
/** after a failed command Redis is skipped for this long, so a hung cache costs ONE slow request, not one per request */
const BREAKER_MS = 5000;

/** Redis cache (REDIS_URL set). Never throws: a down or slow Redis is a miss, so the API keeps answering from PostgreSQL. A failure opens a short circuit
    breaker (BREAKER_MS, on ClockPort) during which no command is sent; the client reconnects on its own. Commands sent while the socket is still connecting
    wait in ioredis' offline queue (bounded by the command timeout), so the first requests after a boot find a working cache instead of a bogus warning. */
export class RedisCacheAdapter extends CachePort implements OnModuleDestroy {
  readonly kind = 'redis';
  private readonly logger = new Logger(RedisCacheAdapter.name);
  private readonly redis: Redis;
  private warned = false;
  private downUntil = 0;

  constructor(url: string, private readonly clock: ClockPort) {
    super();
    this.redis = new Redis(url, { keyPrefix: KEY_PREFIX, maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: COMMAND_TIMEOUT_MS });
    this.redis.on('error', (e: Error) => this.fail(e));
    this.redis.on('ready', () => { this.warned = false; this.downUntil = 0; this.logger.log('redis cache connected'); });
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.isDown()) return null;
    try {
      const json = await this.redis.get(key);
      return json === null ? null : (JSON.parse(json) as T);
    } catch (e) { this.fail(e); return null; }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (this.isDown()) return;
    try { await this.redis.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.round(ttlSeconds))); } catch (e) { this.fail(e); }
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length || this.isDown()) return;
    try { await this.redis.del(...keys); } catch (e) { this.fail(e); }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  private isDown(): boolean {
    return this.clock.now().getTime() < this.downUntil;
  }

  private fail(e: unknown): void {
    this.downUntil = this.clock.now().getTime() + BREAKER_MS;
    if (this.warned) return;
    this.warned = true; // one line per outage, not one per request
    this.logger.warn(`redis cache unavailable, serving from the database: ${e instanceof Error ? e.message : String(e)}`);
  }
}
