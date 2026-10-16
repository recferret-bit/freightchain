import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';

const SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n
`;

/* Redis is mandatory in production. Its fc-mcp ACL can only count fc:mcp-rl:*; it cannot read app caches or replay queues. */
export function createLimiter({ url, token, rps, production = false, redis: injected, now = Date.now }) {
  if (production && !url) throw new Error('REDIS_URL is required for the production MCP');
  // ioredis URL credentials override constructor options, including an empty URL password.
  const redisUrl = url ? new URL(url) : null;
  if (redisUrl?.username === 'fc-mcp') redisUrl.password = token;
  const redis = injected ?? (redisUrl ? new Redis(redisUrl.href, { enableReadyCheck: false, enableOfflineQueue: false, maxRetriesPerRequest: 0, connectTimeout: 2000, commandTimeout: 300 }) : null);
  redis?.on('error', () => {});   // no connection strings or credentials in logs
  const hits = new Map();
  return {
    async allowed(ip) {
      if (redis) {
        const key = createHash('sha256').update(ip).digest('hex');
        try {
          const n = await redis.eval(SCRIPT, 1, `fc:mcp-rl:${key}`, '1000');
          return Number.isSafeInteger(Number(n)) && Number(n) <= rps;
        } catch { return false; }   // no per-process reset of a shared security budget
      }
      const t = now(); let b = hits.get(ip);
      if (!b || t - b.t >= 1000) {
        if (!b && hits.size >= 10000) {
          for (const [k, v] of hits) if (t - v.t >= 1000) hits.delete(k);
          if (hits.size >= 10000) return false;
        }
        b = { t, n: 0 }; hits.set(ip, b);
      }
      return ++b.n <= rps;
    },
    ready: async () => { if (!redis) return true; try { return await redis.ping() === 'PONG'; } catch { return false; } },
    close: () => redis?.quit().catch(() => undefined),
  };
}
