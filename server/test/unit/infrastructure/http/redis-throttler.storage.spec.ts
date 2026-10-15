import { ClockPort } from '../../../../src/application/ports/shared/clock.port.js';
import { RedisThrottlerStorage, type RedisEval } from '../../../../src/infrastructure/http/redis-throttler.storage.js';

class FakeClock extends ClockPort {
  ms = 1_000_000;
  now(): Date { return new Date(this.ms); }
}

class FakeRedis implements RedisEval {
  readonly keys = new Map<string, { n: number; exp: number }>();
  fail = false;
  calls = 0;
  constructor(private readonly clock: FakeClock) {}
  quit = async () => undefined;
  async eval(_script: string, _n: number, key: string, ttl: string): Promise<[number, number]> {
    this.calls += 1;
    if (this.fail) throw new Error('down');
    const now = this.clock.ms;
    let row = this.keys.get(key);
    if (!row || row.exp <= now) row = { n: 0, exp: now + Number(ttl) };
    row.n += 1;
    this.keys.set(key, row);
    return [row.n, row.exp - now];
  }
}

describe('RedisThrottlerStorage', () => {
  it('blocks on the hit after the limit, and a Redis error still counts in this process (with a 5s breaker)', async () => {
    const clock = new FakeClock(), redis = new FakeRedis(clock);
    const store = new RedisThrottlerStorage(redis, clock);
    const hit = () => store.increment('k', 1000, 2, 1000, 'entities-rps');
    expect((await hit()).isBlocked).toBe(false);
    expect((await hit()).isBlocked).toBe(false);
    expect((await hit()).isBlocked).toBe(true);
    expect([...redis.keys.keys()][0]).toMatch(/^fc:rl:entities-rps:/);
    redis.fail = true;
    const again = new RedisThrottlerStorage(redis, clock);
    const before = redis.calls;
    expect((await again.increment('k', 1000, 1, 1000, 'editor-rps')).isBlocked).toBe(false);
    expect((await again.increment('k', 1000, 1, 1000, 'editor-rps')).isBlocked).toBe(true);
    expect(redis.calls).toBe(before + 1);   // second call skipped Redis during the 5s breaker window
    clock.ms += 1001;
    expect((await again.increment('k', 1000, 1, 1000, 'editor-rps')).isBlocked).toBe(false);   // local window rolled over
  });
});
