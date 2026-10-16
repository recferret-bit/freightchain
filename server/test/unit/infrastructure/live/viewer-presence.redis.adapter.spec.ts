import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../../../support/fake-clock.js';

const evalMock = vi.fn();
const quitMock = vi.fn().mockResolvedValue('OK');

vi.mock('ioredis', () => ({
  Redis: class FakeRedis {
    eval = evalMock;
    quit = quitMock;
    on() { return this; }
  },
}));

const { RedisViewerPresenceAdapter } = await import('../../../../src/infrastructure/live/viewer-presence.redis.adapter.js');

describe('RedisViewerPresenceAdapter', () => {
  const clock = new FakeClock();

  beforeEach(() => {
    vi.clearAllMocks();
    clock.ms += 60_000;
  });

  it('tracks spectator counts per ride and globally in Redis via atomic Lua scripts', async () => {
    const adapter = new RedisViewerPresenceAdapter('redis://127.0.0.1:6379', clock);
    evalMock.mockResolvedValueOnce(3);
    expect(await adapter.seen('ride-1', '1.2.3.4', 'v1', clock.now())).toBe(3);

    evalMock.mockResolvedValueOnce(3);
    expect(await adapter.count('ride-1', clock.now())).toBe(3);

    evalMock.mockResolvedValueOnce(5);
    expect(await adapter.watching(clock.now())).toBe(5);

    evalMock.mockResolvedValueOnce(1);
    await adapter.leave('ride-1', '1.2.3.4', 'v1');
    expect(evalMock).toHaveBeenCalledTimes(4);

    await adapter.onModuleDestroy();
    expect(quitMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to in-memory spectator counts when Redis fails', async () => {
    const adapter = new RedisViewerPresenceAdapter('redis://127.0.0.1:6379', clock);
    evalMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await adapter.seen('ride-fb', '1.2.3.4', 'v1', clock.now())).toBe(1);
    expect(await adapter.count('ride-fb', clock.now())).toBe(1);
    expect(await adapter.watching(clock.now())).toBe(1);
    expect(evalMock).toHaveBeenCalledTimes(1);
  });
});
