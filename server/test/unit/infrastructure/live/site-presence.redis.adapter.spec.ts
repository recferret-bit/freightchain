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

const { RedisSitePresenceAdapter } = await import('../../../../src/infrastructure/live/site-presence.redis.adapter.js');

describe('RedisSitePresenceAdapter', () => {
  const clock = new FakeClock();

  beforeEach(() => {
    vi.clearAllMocks();
    clock.ms += 60_000;
  });

  it('tracks visitors and wallets in Redis via atomic Lua scripts', async () => {
    const adapter = new RedisSitePresenceAdapter('redis://127.0.0.1:6379', clock);
    evalMock.mockResolvedValueOnce(1);
    await adapter.seen('1.2.3.4', 'vis-1', 'lobby', 'Wallet111', clock.now());
    expect(evalMock).toHaveBeenCalledTimes(1);

    evalMock.mockResolvedValueOnce([2, ['Wallet111', 'Wallet222']]);
    const snap = await adapter.snapshot(clock.now());
    expect(snap.visitors).toBe(2);
    expect([...snap.wallets]).toEqual(['Wallet111', 'Wallet222']);

    evalMock.mockResolvedValueOnce(1);
    await adapter.leave('1.2.3.4', 'vis-1');
    expect(evalMock).toHaveBeenCalledTimes(3);

    await adapter.onModuleDestroy();
    expect(quitMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to in-memory presence when Redis fails and opens a circuit breaker', async () => {
    const adapter = new RedisSitePresenceAdapter('redis://127.0.0.1:6379', clock);
    evalMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await adapter.seen('1.2.3.4', 'vis-fb', 'lobby', 'WalletFB', clock.now());

    const snap = await adapter.snapshot(clock.now());
    expect(snap.visitors).toBe(1);
    expect([...snap.wallets]).toEqual(['WalletFB']);
    expect(evalMock).toHaveBeenCalledTimes(1); // snapshot skipped Redis while breaker is open
  });
});
