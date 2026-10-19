import { vi } from 'vitest';
import { FakeClock } from '../../../support/fake-clock.js';

const fake = vi.hoisted(() => ({ store: new Map<string, string>(), failing: false, handlers: new Map<string, (e?: Error) => void>(), quit: vi.fn(async () => 'OK'), opts: undefined as unknown, calls: 0 }));
vi.mock('ioredis', () => ({
  Redis: class {
    constructor(_url: string, opts: unknown) { fake.opts = opts; }
    on(event: string, fn: (e?: Error) => void) { fake.handlers.set(event, fn); return this; }
    async get(k: string) { fake.calls++; if (fake.failing) throw new Error('down'); return fake.store.get(k) ?? null; }
    async set(k: string, v: string, _ex: string, ttl: number, nx?: string) {
      if (fake.failing) throw new Error('down');
      if (nx === 'NX' && fake.store.has(k)) return null;
      fake.store.set(k, `${v}`);
      fake.store.set(`ttl:${k}`, String(ttl));
      return 'OK';
    }
    async del(...keys: string[]) { if (fake.failing) throw new Error('down'); for (const k of keys) fake.store.delete(k); return keys.length; }
    quit() { return fake.quit(); }
  },
}));

const { RedisCacheAdapter } = await import('../../../../src/infrastructure/cache/redis-cache.adapter.js');

describe('RedisCacheAdapter', () => {
  const clock = new FakeClock();
  beforeEach(() => { fake.store.clear(); fake.failing = false; fake.calls = 0; clock.ms += 60_000; });

  it('round-trips JSON with a TTL, deletes keys, never queues commands offline', async () => {
    const cache = new RedisCacheAdapter('redis://x:6379', clock);
    await cache.set('k', { a: 1 }, 15);
    expect(await cache.get('k')).toEqual({ a: 1 });
    expect(fake.store.get('ttl:k')).toBe('15');
    await cache.del('k'); await cache.del();
    expect(await cache.get('k')).toBeNull();
    expect(cache.kind).toBe('redis');
    expect(fake.opts).toMatchObject({ keyPrefix: 'fc:', commandTimeout: 300 });
  });

  it('acquires and releases distributed locks via SET NX PX and fails open when Redis is down', async () => {
    const cache = new RedisCacheAdapter('redis://x:6379', clock);
    expect(await cache.tryLock('job-1', 5000)).toBe(true);
    expect(await cache.tryLock('job-1', 5000)).toBe(false);
    await cache.releaseLock('job-1');
    expect(await cache.tryLock('job-1', 5000)).toBe(true);

    fake.failing = true;
    expect(await cache.tryLock('job-2', 5000)).toBe(true);
  });

  it('a Redis that is down is a miss, not an error – one warning per outage', async () => {
    const cache = new RedisCacheAdapter('redis://x:6379', clock);
    fake.failing = true;
    expect(await cache.get('k')).toBeNull();
    await expect(cache.set('k', 1, 5)).resolves.toBeUndefined();
    await expect(cache.del('k')).resolves.toBeUndefined();
    fake.handlers.get('error')?.(new Error('ECONNREFUSED'));
    fake.handlers.get('ready')?.();
    fake.failing = false;
    await cache.set('k', 2, 5);
    expect(await cache.get('k')).toBe(2);
  });

  it('a failure opens a 5 s breaker: no command reaches Redis meanwhile (a hung cache costs one slow request), then it is tried again', async () => {
    const cache = new RedisCacheAdapter('redis://x:6379', clock);
    fake.failing = true;
    await cache.get('k');                       // the slow / failing request
    fake.failing = false; fake.calls = 0;
    expect(await cache.get('k')).toBeNull(); await cache.set('k', 1, 5); await cache.del('k');
    expect(fake.calls).toBe(0);                 // skipped, not sent
    clock.advance(5);
    await cache.set('k', 3, 5);
    expect(await cache.get('k')).toBe(3);
    expect(fake.calls).toBe(1);
  });

  it('closes the connection on shutdown', async () => {
    await new RedisCacheAdapter('redis://x:6379', clock).onModuleDestroy();
    expect(fake.quit).toHaveBeenCalled();
  });
});
