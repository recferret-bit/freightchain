import { MemoryCacheAdapter } from '../../../../src/infrastructure/cache/memory-cache.adapter.js';
import { FakeClock } from '../../../support/fake-clock.js';

describe('MemoryCacheAdapter', () => {
  it('stores JSON copies until the TTL runs out on the injected clock; del removes keys', async () => {
    const clock = new FakeClock();
    const cache = new MemoryCacheAdapter(clock);
    const value = { a: 1 };
    await cache.set('k', value, 10);
    value.a = 2;   // a later change of the caller's object never reaches the cache
    expect(await cache.get('k')).toEqual({ a: 1 });
    clock.advance(9);
    expect(await cache.get('k')).toEqual({ a: 1 });
    clock.advance(1);
    expect(await cache.get('k')).toBeNull();
    await cache.set('x', 1, 60); await cache.set('y', 2, 60);
    await cache.del('x', 'missing');
    expect(await cache.get('x')).toBeNull(); expect(await cache.get('y')).toBe(2);
    expect(cache.kind).toBe('memory');
  });

  it('is bounded: the oldest key goes first', async () => {
    const cache = new MemoryCacheAdapter(new FakeClock());
    for (let i = 0; i < 5001; i++) await cache.set(`k${i}`, i, 60);
    expect(await cache.get('k0')).toBeNull();
    expect(await cache.get('k5000')).toBe(5000);
  });
});
