import { vi } from 'vitest';
import type { ReplayQueueJob } from '../../../../src/application/ports/verdict/replay-queue.port.js';
import { FakeClock } from '../../../support/fake-clock.js';

const hsetMock = vi.fn().mockResolvedValue(1);
const zaddMock = vi.fn().mockResolvedValue(1);
const execMock = vi.fn().mockResolvedValue([]);
const multiMock = vi.fn(() => ({
  hset: () => ({ zadd: () => ({ exec: execMock }) }),
}));
const zpopminMock = vi.fn();
const hmgetMock = vi.fn();
const hdelMock = vi.fn().mockResolvedValue(1);
const zcardMock = vi.fn().mockResolvedValue(1);
const hlenMock = vi.fn().mockResolvedValue(0);
const quitMock = vi.fn().mockResolvedValue('OK');

vi.mock('ioredis', () => ({
  Redis: class FakeRedis {
    multi = multiMock;
    hset = hsetMock;
    zadd = zaddMock;
    zpopmin = zpopminMock;
    hmget = hmgetMock;
    hdel = hdelMock;
    zcard = zcardMock;
    hlen = hlenMock;
    quit = quitMock;
    on() { return this; }
  },
}));

const { RedisReplayQueueAdapter } = await import('../../../../src/infrastructure/verdict/redis-replay-queue.adapter.js');

describe('RedisReplayQueueAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enqueues, dequeues, acknowledges, releases, and reports depth via Redis', async () => {
    const clock = new FakeClock();
    const q = new RedisReplayQueueAdapter('redis://127.0.0.1:6379', clock);
    expect(q.kind).toBe('redis');

    const job: ReplayQueueJob = { rideId: 'r-1', replayId: 'rep-1', isPaid: true, enqueuedAt: 1000 };
    expect(await q.enqueue(job)).toBe(true);
    expect(multiMock).toHaveBeenCalledTimes(1);

    zpopminMock.mockResolvedValueOnce(['r-1', '1000']);
    hmgetMock.mockResolvedValueOnce([JSON.stringify(job)]);

    const batch = await q.dequeueBatch(2);
    expect(zpopminMock).toHaveBeenCalledWith('zset', 2);
    expect(batch).toEqual([job]);
    expect(hsetMock).toHaveBeenCalledWith('inflight', 'r-1', JSON.stringify(job));
    expect(hdelMock).toHaveBeenCalledWith('jobs', 'r-1');

    await q.acknowledge('r-1', 'rep-1');
    expect(hdelMock).toHaveBeenCalledWith('inflight', 'r-1');

    await q.release(job, 'retry');
    expect(await q.depth()).toBe(1);

    await q.onModuleDestroy();
    expect(quitMock).toHaveBeenCalled();
  });

  it('falls back transparently to the in-memory queue when Redis throws', async () => {
    const clock = new FakeClock();
    const q = new RedisReplayQueueAdapter('redis://127.0.0.1:6379', clock);
    const job: ReplayQueueJob = { rideId: 'r-fb', replayId: 'rep-fb', isPaid: true, enqueuedAt: 2000 };

    execMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await q.enqueue(job)).toBe(true);
    expect(await q.depth()).toBe(1);

    const batch = await q.dequeueBatch(1);
    expect(batch).toEqual([job]);
    await q.acknowledge('r-fb', 'rep-fb');
    expect(await q.depth()).toBe(0);
  });
});
