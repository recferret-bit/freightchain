import { Logger, type OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';

/** What the storage needs from Redis (a test passes a fake). `eval` returns `[hits, pttl ms]`. */
export interface RedisEval {
  eval(script: string, numKeys: number, key: string, ttl: string): Promise<unknown>;
  quit(): Promise<unknown>;
  on?(event: 'error', listener: (err: Error) => void): void;
}

const SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) ttl = tonumber(ARGV[1]) end
return {n, ttl}
`;

/** Injected into ThrottlerModule when REDIS_URL is set. Null when it is not (dev, tests): Nest keeps its in-process counters. */
export const RateLimitStorage = Symbol('RateLimitStorage');

/**
 * Shared rate-limit counters (`fc:rl:<bucket>:<key>`, fixed window of `ttl` ms). A Redis error falls back to an in-process window for
 * THIS process, so a blip does not turn the limit off and does not 500 the request. The fallback map is capped so a down Redis cannot grow it without bound.
 */
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly log = new Logger('RateLimit');
  private readonly local = new Map<string, { n: number; exp: number }>();
  private warned = false;

  constructor(private readonly redis: RedisEval) {
    this.redis.on?.('error', (e) => this.note(e));
    this.redis.on?.('ready', () => { this.warned = false; });
  }

  static connect(url: string): RedisThrottlerStorage {
    const redis = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 300 });
    return new RedisThrottlerStorage(redis);
  }

  async increment(key: string, ttl: number, limit: number, _blockDuration: number, throttlerName: string): Promise<{ totalHits: number; timeToExpire: number; isBlocked: boolean; timeToBlockExpire: number }> {
    try {
      const raw = (await this.redis.eval(SCRIPT, 1, `fc:rl:${throttlerName}:${key}`, String(ttl))) as [number, number];
      return record(Number(raw[0]), Number(raw[1]), limit);
    } catch (e) {
      this.note(e);
      return this.localIncrement(`${throttlerName}:${key}`, ttl, limit);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  private localIncrement(key: string, ttl: number, limit: number): { totalHits: number; timeToExpire: number; isBlocked: boolean; timeToBlockExpire: number } {
    const now = Date.now();
    let row = this.local.get(key);
    if (!row || row.exp <= now) row = { n: 0, exp: now + ttl };
    row.n += 1;
    this.local.set(key, row);
    if (this.local.size > 20_000) this.local.clear();
    return record(row.n, row.exp - now, limit);
  }

  private note(e: unknown): void {
    if (this.warned) return;
    this.warned = true;
    this.log.warn(`redis rate limit unavailable, counting in this process: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Nest wants seconds. Blocked once the window has MORE than `limit` hits (the same rule as the in-process storage). */
function record(totalHits: number, pttlMs: number, limit: number): { totalHits: number; timeToExpire: number; isBlocked: boolean; timeToBlockExpire: number } {
  const timeToExpire = Math.max(0, Math.ceil(pttlMs / 1000));
  const isBlocked = totalHits > limit;
  return { totalHits, timeToExpire, isBlocked, timeToBlockExpire: isBlocked ? Math.max(1, timeToExpire) : 0 };
}
