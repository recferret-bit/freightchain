import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ViewerPresencePort } from '../../application/ports/live/viewer-presence.port.js';
import type { ClockPort } from '../../application/ports/shared/clock.port.js';
import { VIEWERS_PER_SOURCE, VIEWER_WINDOW_MS } from '../../domain/live/live-rules.js';
import { MemoryViewerPresenceAdapter } from './viewer-presence.memory.adapter.js';

const MAX_RIDES = 2000;
const MAX_VIEWERS = 5000;
const TTL_MS = VIEWER_WINDOW_MS + 5_000;
const COMMAND_TIMEOUT_MS = 300;
const BREAKER_MS = 5_000;

const RIDES_KEY = 'fc:presence:viewers:rides';

const SEEN_LUA = `
local ridesKey = KEYS[1]
local rideKey = KEYS[2]
local srcKey = KEYS[3]
local rideId = ARGV[1]
local member = ARGV[2]
local viewer = ARGV[3]
local at = tonumber(ARGV[4])
local cutoff = tonumber(ARGV[5])
local perSource = tonumber(ARGV[6])
local maxViewers = tonumber(ARGV[7])
local maxRides = tonumber(ARGV[8])
local ttl = tonumber(ARGV[9])

redis.call('ZREMRANGEBYSCORE', rideKey, '-inf', cutoff)
redis.call('ZREMRANGEBYSCORE', srcKey, '-inf', cutoff)
redis.call('ZREMRANGEBYSCORE', ridesKey, '-inf', cutoff)

if redis.call('ZCARD', ridesKey) >= maxRides and not redis.call('ZSCORE', ridesKey, rideId) then
  local stalestRide = redis.call('ZRANGE', ridesKey, 0, 0)
  if #stalestRide > 0 then
    redis.call('ZREM', ridesKey, stalestRide[1])
    redis.call('DEL', 'fc:presence:viewers:ride:' .. stalestRide[1])
  end
end
redis.call('ZADD', ridesKey, at, rideId)
redis.call('PEXPIRE', ridesKey, ttl)

local known = redis.call('ZSCORE', rideKey, member)
if known then
  redis.call('ZADD', rideKey, at, member)
  redis.call('ZADD', srcKey, at, viewer)
elseif redis.call('ZCARD', srcKey) < perSource then
  if redis.call('ZCARD', rideKey) >= maxViewers then
    local oldest = redis.call('ZRANGE', rideKey, 0, 0)
    if #oldest > 0 then
      redis.call('ZREM', rideKey, oldest[1])
    end
  end
  redis.call('ZADD', rideKey, at, member)
  redis.call('ZADD', srcKey, at, viewer)
end

redis.call('PEXPIRE', rideKey, ttl)
redis.call('PEXPIRE', srcKey, ttl)
return redis.call('ZCARD', rideKey)
`;

const LEAVE_LUA = `
local rideKey = KEYS[1]
local srcKey = KEYS[2]
local member = ARGV[1]
local viewer = ARGV[2]
redis.call('ZREM', rideKey, member)
redis.call('ZREM', srcKey, viewer)
return 1
`;

const COUNT_LUA = `
local rideKey = KEYS[1]
local cutoff = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', rideKey, '-inf', cutoff)
return redis.call('ZCARD', rideKey)
`;

const WATCHING_LUA = `
local ridesKey = KEYS[1]
local cutoff = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', ridesKey, '-inf', cutoff)
local rides = redis.call('ZRANGE', ridesKey, 0, -1)
local seen = {}
local total = 0
for i = 1, #rides do
  local rKey = 'fc:presence:viewers:ride:' .. rides[i]
  redis.call('ZREMRANGEBYSCORE', rKey, '-inf', cutoff)
  local members = redis.call('ZRANGE', rKey, 0, -1)
  for j = 1, #members do
    local m = members[j]
    if not seen[m] then
      seen[m] = true
      total = total + 1
    end
  end
end
return total
`;

/** Redis-backed spectator presence across horizontal replicas, with automatic circuit-breaker fallback to MemoryViewerPresenceAdapter. */
export class RedisViewerPresenceAdapter extends ViewerPresencePort implements OnModuleDestroy {
  private readonly logger = new Logger(RedisViewerPresenceAdapter.name);
  private readonly redis: Redis;
  private readonly fallback = new MemoryViewerPresenceAdapter();
  private downUntil = 0;
  private warned = false;

  constructor(url: string, private readonly clock: ClockPort) {
    super();
    this.redis = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: COMMAND_TIMEOUT_MS });
    this.redis.on('error', (e: Error) => this.fail(e));
    this.redis.on('ready', () => { this.warned = false; this.downUntil = 0; });
  }

  async seen(rideId: string, source: string, viewer: string, now: Date): Promise<number> {
    const local = this.fallback.seen(rideId, source, viewer, now);
    if (this.isDown()) return local;
    const at = now.getTime();
    try {
      const n = await this.redis.eval(
        SEEN_LUA, 3, RIDES_KEY, `fc:presence:viewers:ride:${rideId}`, `fc:presence:viewers:src:${rideId}:${source}`,
        rideId, `${source}|${viewer}`, viewer, String(at), String(at - VIEWER_WINDOW_MS - 1),
        String(VIEWERS_PER_SOURCE), String(MAX_VIEWERS), String(MAX_RIDES), String(TTL_MS),
      );
      return Number(n ?? 0);
    } catch (e) {
      this.fail(e);
      return local;
    }
  }

  async leave(rideId: string, source: string, viewer: string): Promise<void> {
    this.fallback.leave(rideId, source, viewer);
    if (this.isDown()) return;
    try {
      await this.redis.eval(
        LEAVE_LUA, 2, `fc:presence:viewers:ride:${rideId}`, `fc:presence:viewers:src:${rideId}:${source}`,
        `${source}|${viewer}`, viewer,
      );
    } catch (e) { this.fail(e); }
  }

  async count(rideId: string, now: Date): Promise<number> {
    const local = this.fallback.count(rideId, now);
    if (this.isDown()) return local;
    try {
      const n = await this.redis.eval(COUNT_LUA, 1, `fc:presence:viewers:ride:${rideId}`, String(now.getTime() - VIEWER_WINDOW_MS - 1));
      return Number(n ?? 0);
    } catch (e) {
      this.fail(e);
      return local;
    }
  }

  async watching(now: Date): Promise<number> {
    const local = this.fallback.watching(now);
    if (this.isDown()) return local;
    try {
      const n = await this.redis.eval(WATCHING_LUA, 1, RIDES_KEY, String(now.getTime() - VIEWER_WINDOW_MS - 1));
      return Number(n ?? 0);
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
    this.logger.warn(`redis viewer presence unavailable, falling back to memory: ${e instanceof Error ? e.message : String(e)}`);
  }
}
