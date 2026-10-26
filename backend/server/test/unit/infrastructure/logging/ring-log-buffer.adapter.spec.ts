import { RingLogBufferAdapter } from '../../../../src/infrastructure/logging/ring-log-buffer.adapter.js';
import { LOG_RETENTION_MS, LOG_SWEEP_MS, LogRing } from '../../../../src/infrastructure/logging/log-ring.js';
import { FakeClock } from '../../../support/fake-clock.js';

describe('RingLogBufferAdapter', () => {
  it('answers the port from the shared ring and never returns expired entries', async () => {
    const clock = new FakeClock(), ring = new LogRing(clock, 5), adapter = new RingLogBufferAdapter(ring, clock);
    const entry = { time: clock.now().toISOString(), level: 'warn' as const, context: 'X', msg: 'hello' };
    ring.push(entry);
    expect(await adapter.recent({ limit: 5, minLevel: 'warn' })).toEqual([entry]);
    clock.advance(LOG_RETENTION_MS / 1000);
    expect(await adapter.recent({ limit: 5 })).toEqual([]);
    await adapter.onModuleDestroy();
  });

  it('physically evicts idle entries on its timer and stops the timer on shutdown', async () => {
    vi.useFakeTimers();
    const clock = new FakeClock(), ring = new LogRing(clock), adapter = new RingLogBufferAdapter(ring, clock);
    try {
      adapter.onModuleInit();
      ring.push({ time: clock.now().toISOString(), level: 'log', context: 'X', msg: 'private' });
      clock.advance(LOG_RETENTION_MS / 1000);
      await vi.advanceTimersByTimeAsync(LOG_SWEEP_MS);
      expect((ring as unknown as { items: unknown[] }).items.every(item => item === undefined)).toBe(true);
      await adapter.onModuleDestroy();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
