import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import request from 'supertest';
import { RedisThrottlerStorage } from '../../src/infrastructure/http/redis-throttler.storage.js';
import { SystemClock } from '../../src/infrastructure/time/system.clock.js';
import { createHarness } from '../support/harness.js';

describe('Redis rate limits and least-privilege MCP access', () => {
  let container: string, url: string, redis: Redis;
  const stores: RedisThrottlerStorage[] = [];
  beforeAll(async () => {
    container = execFileSync('docker', ['run', '-d', '--rm', '-p', '127.0.0.1::6379', 'redis:7-alpine', 'redis-server', '--save', '', '--appendonly', 'no'], { encoding: 'utf8' }).trim();
    const port = execFileSync('docker', ['port', container, '6379'], { encoding: 'utf8' }).trim().split(':').at(-1);
    url = `redis://127.0.0.1:${port}`;
    redis = new Redis(url);
    await redis.ping();
  });
  afterAll(async () => {
    await Promise.all(stores.map(s => s.onModuleDestroy()));
    await redis?.quit();
    if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' });
  });

  it('two independent storage instances enforce one atomic budget, repair missing TTLs and expire windows', async () => {
    const a = new RedisThrottlerStorage(new Redis(url), new SystemClock()), b = new RedisThrottlerStorage(new Redis(url), new SystemClock());
    stores.push(a, b);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).increment(key, 1000, 3, 1000, 'editor-rps')));
    expect(results.filter(r => !r.isBlocked)).toHaveLength(3);
    expect(await redis.pttl(`fc:rl:editor-rps:${key}`)).toBeGreaterThan(0);
    await redis.set(`fc:rl:editor-rps:${key}`, '2');
    expect(await a.increment(key, 50, 3, 50, 'editor-rps')).toMatchObject({ totalHits: 3, isBlocked: false });
    expect(await redis.pttl(`fc:rl:editor-rps:${key}`)).toBeGreaterThan(0);
    await new Promise(r => setTimeout(r, 70));
    expect(await b.increment(key, 1000, 3, 1000, 'editor-rps')).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('HTTP budgets aggregate across controllers and app instances, and keep IPs separate', async () => {
    const env = { REDIS_URL: url, THROTTLE_EDITOR_RPS: '2', TRUST_PROXY: '1' };
    const a = await createHarness('memory', env), b = await createHarness('memory', env);
    try {
      await request(a.server()).get('/api/editor/me').set('X-Forwarded-For', '203.0.113.1').expect(404);
      await request(b.server()).get('/api/editor/entities').set('X-Forwarded-For', '203.0.113.1').expect(404);
      const limited = await request(a.server()).get('/api/editor/jobs').set('X-Forwarded-For', '203.0.113.1').expect(429);
      expect(limited.headers['retry-after']).toBeDefined();
      await request(b.server()).get('/api/editor/me').set('X-Forwarded-For', '203.0.113.2').expect(404);
    } finally { await a.close(); await b.close(); }
  });

  it('the MCP Redis ACL permits atomic counters but denies app keys and administrative commands', async () => {
    const password = 'review-test-token-0123456789';
    await redis.acl('SETUSER', 'fc-mcp', 'on', `>${password}`, '~fc:mcp-rl:*', '+eval', '+incr', '+pexpire', '+pttl', '+ping', '+quit', '+client|setinfo');
    const client = new Redis(url, { username: 'fc-mcp', password, enableReadyCheck: false });
    try {
      expect(await client.eval("return redis.call('INCR', KEYS[1])", 1, 'fc:mcp-rl:test')).toBe(1);
      await expect(client.get('fc:replay-queue:jobs')).rejects.toThrow(/NOPERM/);
      await expect(client.eval("return redis.call('INCR', KEYS[1])", 1, 'fc:rl:editor:other')).rejects.toThrow(/permission|NOPERM/);
      await expect(client.flushall()).rejects.toThrow(/NOPERM/);
    } finally { await client.quit(); }
  });
});
