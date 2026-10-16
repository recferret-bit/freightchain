import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { SitePresencePort } from '../../application/ports/live/site-presence.port.js';
import type { ClockPort } from '../../application/ports/shared/clock.port.js';
import { MemorySitePresenceAdapter } from './site-presence.memory.adapter.js';

const WINDOW_MS = 30_000;
const TTL_MS = 35_000;
const PER_SOURCE = 3;
const MAX_VISITORS = 50_000;
const COMMAND_TIMEOUT_MS = 300;
const BREAKER_MS = 5_000;

const Z_KEY = 'fc:presence:site:z';
const W_KEY = 'fc:presence:site:w';

const SEEN_LUA = `
local zKey = KEYS[1]
local wKey = KEYS[2]
local srcKey = KEYS[3]
local member = ARGV[1]
local visitor = ARGV[2]
local wallet = ARGV[3]
local at = tonumber(ARGV[4])
local cutoff = tonumber(ARGV[5])
local perSource = tonumber(ARGV[6])
local maxVisitors = tonumber(ARGV[7])
local ttl = tonumber(ARGV[8])

local expired = redis.call('ZRANGEBYSCORE', zKey, '-inf', cutoff)
if #expired > 0 then
  redis.call('ZREM', zKey, unpack(expired))
  redis.call('HDEL', wKey, unpack(expired))
end
redis.call('ZREMRANGEBYSCORE', srcKey, '-inf', cutoff)

local known = redis.call('ZSCORE', zKey, member)
if not known then
  if redis.call('ZCARD', srcKey) >= perSource then
    return 0
  end
  local total = redis.call('ZCARD', zKey)
  if total >= maxVisitors then
    local stalest = redis.call('ZRANGE', zKey, 0, 0)
    if #stalest > 0 then
      redis.call('ZREM', zKey, stalest[1])
      redis.call('HDEL', wKey, stalest[1])
    end
  end
end

redis.call('ZADD', srcKey, at, visitor)
redis.call('PEXPIRE', srcKey, ttl)
redis.call('ZADD', zKey, at, member)
redis.call('PEXPIRE', zKey, ttl)
if wallet ~= '' then
  redis.call('HSET', wKey, member, wallet)
  redis.call('PEXPIRE', wKey, ttl)
else
  redis.call('HDEL', wKey, member)
end
return 1
`;

const LEAVE_LUA = `
local zKey = KEYS[1]
local wKey = KEYS[2]
local srcKey = KEYS[3]
local member = ARGV[1]
local visitor = ARGV[2]
redis.call('ZREM', zKey, member)
redis.call('ZREM', srcKey, visitor)
redis.call('HDEL', wKey, member)
return 1
`;

const SNAPSHOT_LUA = `
local zKey = KEYS[1]
local wKey = KEYS[2]
local cutoff = tonumber(ARGV[1])
local expired = redis.call('ZRANGEBYSCORE', zKey, '-inf', cutoff)
if #expired > 0 then
  redis.call('ZREM', zKey, unpack(expired))
  redis.call('HDEL', wKey, unpack(expired))
end
local count = redis.call('ZCARD', zKey)
local wallets = redis.call('HVALS', wKey)
return { count, wallets }
`;

/** Redis-backed site presence across horizontal replicas, with automatic circuit-breaker fallback to MemorySitePresenceAdapter. */
export class RedisSitePresenceAdapter extends SitePresencePort implements OnModuleDestroy {
  private readonly logger = new Logger(RedisSitePresenceAdapter.name);
  private readonly redis: Redis;
  private readonly fallback = new MemorySitePresenceAdapter();
  private downUntil = 0;
  private warned = false;

  constructor(url: string, private readonly clock: ClockPort) {
    super();
    this.redis = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: COMMAND_TIMEOUT_MS });
    this.redis.on('error', (e: Error) => this.fail(e));
    this.redis.on('ready', () => { this.warned = false; this.downUntil = 0; });
  }

  async seen(source: string, visitor: string, page: string, wallet: string | null, now: Date): Promise<void> {
    this.fallback.seen(source, visitor, page, wallet, now);
    if (this.isDown()) return;
    const at = now.getTime();
    try {
      await this.redis.eval(
        SEEN_LUA, 3, Z_KEY, W_KEY, `fc:presence:site:src:${source}`,
        `${source}|${visitor}`, visitor, wallet ?? '', String(at), String(at - WINDOW_MS - 1),
        String(PER_SOURCE), String(MAX_VISITORS), String(TTL_MS),
      );
    } catch (e) { this.fail(e); }
  }

  async leave(source: string, visitor: string): Promise<void> {
    this.fallback.leave(source, visitor);
    if (this.isDown()) return;
    try {
      await this.redis.eval(LEAVE_LUA, 3, Z_KEY, W_KEY, `fc:presence:site:src:${source}`, `${source}|${visitor}`, visitor);
    } catch (e) { this.fail(e); }
  }

  async snapshot(now: Date): Promise<{ visitors: number; wallets: Set<string> }> {
    const local = this.fallback.snapshot(now);
    if (this.isDown()) return local;
    try {
      const raw = (await this.redis.eval(SNAPSHOT_LUA, 2, Z_KEY, W_KEY, String(now.getTime() - WINDOW_MS - 1))) as [number, string[]];
      return { visitors: Number(raw[0] ?? 0), wallets: new Set(raw[1] ?? []) };
    } catch (e) {
      this.fail(e);
      return local;
    }
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
    this.warned = true;
    this.logger.warn(`redis site presence unavailable, falling back to memory: ${e instanceof Error ? e.message : String(e)}`);
  }
}
