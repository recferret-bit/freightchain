import { Injectable, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { LogBufferPort } from '../../application/ports/ops/log-buffer.port.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import type { LogEntry, LogFilter } from '../../domain/ops/log-entry.js';
import { EnvService } from '../config/env.service.js';
import { LOG_RETENTION_MS, LOG_RING_SIZE, LOG_SWEEP_MS, LogRing, matchesLogFilter, retainedLog } from './log-ring.js';

const REDIS_LOGS_KEY = 'fc:ops:logs';
// One atomic operation preserves duplicate entries and cross-replica append order. The list is bounded at 5,000.
const RETAIN_LUA = `
if ARGV[1] ~= '' then redis.call('LPUSH', KEYS[1], ARGV[1]) end
local rows = redis.call('LRANGE', KEYS[1], 0, tonumber(ARGV[2]) - 1)
local kept = {}
for _, row in ipairs(rows) do
  local ok, entry = pcall(cjson.decode, row)
  if ok and type(entry) == 'table' and type(entry.time) == 'string'
    and string.match(entry.time, '^%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%d%.%d%d%dZ$')
    and entry.time > ARGV[3] and entry.time <= ARGV[4] then
    table.insert(kept, row)
  end
end
if #kept ~= #rows then
  redis.call('DEL', KEYS[1])
  for _, row in ipairs(kept) do redis.call('RPUSH', KEYS[1], row) end
else
  redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[2]) - 1)
end
if #kept > 0 then redis.call('PEXPIRE', KEYS[1], ARGV[5]) end
if ARGV[6] == 'read' then return kept end
return {}
`;

@Injectable()
export class RingLogBufferAdapter extends LogBufferPort implements OnModuleInit, OnModuleDestroy {
  private readonly redis: Redis | null = null;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly ring: LogRing,
    private readonly clock: ClockPort,
    @Optional() env?: EnvService,
  ) {
    super();
    if (env?.redisUrl) {
      this.redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 300 });
      this.redis.on('error', () => undefined);
      this.ring.onPush((entry) => { void this.retainedFromRedis(entry).catch(() => undefined); });
    }
  }

  onModuleInit(): void {
    void this.sweep();
    this.timer = setInterval(() => { void this.sweep(); }, LOG_SWEEP_MS);
    this.timer.unref();
  }

  recent(filter: LogFilter): LogEntry[] | Promise<LogEntry[]> {
    if (!this.redis) return this.ring.recent(filter);
    return this.recentFromRedis(filter);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.ring.onPush(null);
    await this.redis?.quit().catch(() => undefined);
  }

  private async sweep(): Promise<void> {
    this.ring.prune();
    await this.retainedFromRedis().catch(() => undefined);
  }

  private async retainedFromRedis(entry?: LogEntry, read = false): Promise<string[]> {
    if (!this.redis) return [];
    const now = this.clock.now();
    return await this.redis.eval(RETAIN_LUA, 1, REDIS_LOGS_KEY, entry ? JSON.stringify(entry) : '', String(LOG_RING_SIZE),
      new Date(now.getTime() - LOG_RETENTION_MS).toISOString(), now.toISOString(), String(2 * LOG_SWEEP_MS), read ? 'read' : 'write') as string[];
  }

  private async recentFromRedis(filter: LogFilter): Promise<LogEntry[]> {
    try {
      const raw = await this.retainedFromRedis(undefined, true);
      if (!raw.length) return this.ring.recent(filter);
      const out: LogEntry[] = [];
      const needle = filter.text?.toLowerCase(), now = this.clock.now().getTime();
      for (const item of raw) {
        if (out.length >= filter.limit) break;
        const entry = JSON.parse(item) as LogEntry;
        if (retainedLog(entry, now) && matchesLogFilter(entry, filter, needle)) out.push(entry);
      }
      return out;
    } catch {
      return this.ring.recent(filter);
    }
  }
}
