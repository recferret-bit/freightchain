import { afterEach, beforeEach, vi } from 'vitest';
import { ReleaseHonkCommand } from '../../../../src/application/use-cases/honk/release-honk.command.js';
import { HonkReleaseScheduler } from '../../../../src/infrastructure/scheduling/honk-release.scheduler.js';

describe('HonkReleaseScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('releases on boot, then every 60s, and stops on shutdown', async () => {
    let calls = 0;
    const bus = { execute: async (c: object) => { calls++; expect(c).toBeInstanceOf(ReleaseHonkCommand); if (calls === 2) throw new Error('db down'); return 1; } };
    const scheduler = new HonkReleaseScheduler(bus as never);
    expect(scheduler.intervalMs).toBe(60_000);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000); expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000); expect(calls).toBe(3);
    scheduler.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(180_000); expect(calls).toBe(3);
  });
});
