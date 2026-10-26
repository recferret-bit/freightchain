import { execFileSync } from 'node:child_process';
import { Redis } from 'ioredis';
import { RingLogBufferAdapter } from '../../src/infrastructure/logging/ring-log-buffer.adapter.js';
import { LOG_RETENTION_MS, LOG_SWEEP_MS, LogRing } from '../../src/infrastructure/logging/log-ring.js';
import type { EnvService } from '../../src/infrastructure/config/env.service.js';
import { FakeClock } from '../support/fake-clock.js';

const key = 'fc:ops:logs';
describe('Redis admin log retention (disposable cache)', () => {
  let container: string, url: string, redis: Redis;
  const adapters: RingLogBufferAdapter[] = [];
  beforeAll(async () => {
    container = execFileSync('docker', ['run', '-d', '--rm', '-p', '127.0.0.1::6379', 'redis:7-alpine', 'redis-server', '--save', '', '--appendonly', 'no'], { encoding: 'utf8' }).trim();
    const port = execFileSync('docker', ['port', container, '6379'], { encoding: 'utf8' }).trim().split(':').at(-1);
    url = `redis://127.0.0.1:${port}`;
    redis = new Redis(url);
    await redis.ping();
  });
  afterAll(async () => {
    await Promise.all(adapters.map(a => a.onModuleDestroy()));
    await redis?.quit();
    if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' });
  });
  beforeEach(async () => { await redis.del(key); });
  const setup = () => {
    const clock = new FakeClock(), ring = new LogRing(clock), adapter = new RingLogBufferAdapter(ring, clock, { redisUrl: url } as EnvService);
    adapters.push(adapter);
    return { clock, ring, adapter };
  };
  const entry = (clock: FakeClock, msg: string) => ({ time: clock.now().toISOString(), level: 'warn' as const, context: 'HTTP', msg });

  it('atomically removes old and malformed legacy list rows, preserving duplicates/order/filtering and setting a backup TTL', async () => {
    const { clock, adapter } = setup(), fresh = entry(clock, 'fresh');
    const expired = { ...fresh, time: new Date(clock.ms - LOG_RETENTION_MS).toISOString(), msg: 'old raw IP' };
    await redis.rpush(key, JSON.stringify(fresh), JSON.stringify(expired), '{invalid', JSON.stringify(fresh));
    expect(await adapter.recent({ limit: 5, text: 'FRESH', minLevel: 'warn' })).toEqual([fresh, fresh]);
    expect(await redis.lrange(key, 0, -1)).toEqual([JSON.stringify(fresh), JSON.stringify(fresh)]);
    expect(await redis.pttl(key)).toBeGreaterThan(0);
    expect(await redis.pttl(key)).toBeLessThanOrEqual(2 * LOG_SWEEP_MS);
    clock.advance(LOG_RETENTION_MS / 1000);
    expect(await adapter.recent({ limit: 5 })).toEqual([]);
    expect(await redis.exists(key)).toBe(0);
  });

  it('concurrent replica writes retain all entries, prune stale data and preserve the 5,000 cap', async () => {
    const a = setup(), b = setup();
    const old = { ...entry(a.clock, 'old'), time: new Date(a.clock.ms - LOG_RETENTION_MS).toISOString() };
    await redis.rpush(key, JSON.stringify(old));
    for (let i = 0; i < 20; i++) (i % 2 ? a : b).ring.push(entry(a.clock, `replica-${i}`));
    await Promise.all([a.adapter.recent({ limit: 30 }), b.adapter.recent({ limit: 30 })]);
    const rows = await a.adapter.recent({ limit: 30 });
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map(e => e.msg)).size).toBe(20);
    await redis.rpush(key, ...Array.from({ length: 5000 }, () => JSON.stringify(entry(a.clock, 'capacity'))));
    a.ring.push(entry(a.clock, 'last'));
    await a.adapter.recent({ limit: 1 });
    expect(await redis.llen(key)).toBe(5000);
    expect(JSON.parse((await redis.lindex(key, 0))!).msg).toBe('last');
  });

  it('startup physically clears idle old records; Redis errors fall back to age-filtered memory', async () => {
    const { clock, ring, adapter } = setup();
    await redis.rpush(key, JSON.stringify({ ...entry(clock, 'stale'), time: new Date(clock.ms - LOG_RETENTION_MS).toISOString() }));
    adapter.onModuleInit();
    await adapter.recent({ limit: 1 });
    expect(await redis.exists(key)).toBe(0);
    ring.push(entry(clock, 'local'));
    await adapter.recent({ limit: 1 });
    await redis.del(key);
    await redis.set(key, 'wrong-type-outage');
    expect((await adapter.recent({ limit: 5 })).map(e => e.msg)).toEqual(['local']);
    clock.advance(LOG_RETENTION_MS / 1000);
    expect(await adapter.recent({ limit: 5 })).toEqual([]);
  });
});
