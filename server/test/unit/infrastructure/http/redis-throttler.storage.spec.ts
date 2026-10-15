import { RedisThrottlerStorage, type RedisEval } from '../../../../src/infrastructure/http/redis-throttler.storage.js';

class FakeRedis implements RedisEval {
  readonly keys = new Map<string, { n: number; exp: number }>();
  fail = false;
  quit = async () => undefined;
  async eval(_script: string, _n: number, key: string, ttl: string): Promise<[number, number]> {
    if (this.fail) throw new Error('down');
    const now = Date.now();
    let row = this.keys.get(key);
    if (!row || row.exp <= now) row = { n: 0, exp: now + Number(ttl) };
    row.n += 1;
    this.keys.set(key, row);
    return [row.n, row.exp - now];
  }
}

describe('RedisThrottlerStorage', () => {
  it('blocks on the hit after the limit, and a Redis error still counts in this process', async () => {
    const redis = new FakeRedis();
    const store = new RedisThrottlerStorage(redis);
    const hit = () => store.increment('k', 1000, 2, 1000, 'entities-rps');
    expect((await hit()).isBlocked).toBe(false);
    expect((await hit()).isBlocked).toBe(false);
    expect((await hit()).isBlocked).toBe(true);
    expect([...redis.keys.keys()][0]).toMatch(/^fc:rl:entities-rps:/);
    redis.fail = true;
    const again = new RedisThrottlerStorage(redis);
    expect((await again.increment('k', 1000, 1, 1000, 'editor-rps')).isBlocked).toBe(false);
    expect((await again.increment('k', 1000, 1, 1000, 'editor-rps')).isBlocked).toBe(true);
  });
});
