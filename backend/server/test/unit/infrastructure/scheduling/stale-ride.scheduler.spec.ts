import { afterEach, beforeEach, vi } from 'vitest';
import { SweepStaleRidesCommand } from '../../../../src/application/use-cases/rides/sweep-stale-rides/sweep-stale-rides.command.js';
import { StaleRideScheduler } from '../../../../src/infrastructure/scheduling/stale-ride.scheduler.js';
import { busMock } from '../../../support/bus.js';
import { FixedRules, unitRules } from '../../../support/unit-context.js';

describe('StaleRideScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('sweeps on boot, then every min(30 s, timeout / 3); keeps going after a failed sweep; stops on shutdown', async () => {
    let calls = 0;
    const bus = { execute: async (c: object) => { calls++; expect(c).toBeInstanceOf(SweepStaleRidesCommand); if (calls === 2) throw new Error('db down'); return { ended: 1, skipped: 0 }; } };
    const scheduler = new StaleRideScheduler(bus as never, new FixedRules(unitRules({ hbTimeoutMs: 150_000 })));
    expect(scheduler.intervalMs).toBe(30_000);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000); expect(calls).toBe(2);   // this one fails
    await vi.advanceTimersByTimeAsync(30_000); expect(calls).toBe(3);   // …and the next still runs
    scheduler.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(120_000); expect(calls).toBe(3);
    expect(new StaleRideScheduler(busMock().bus as never, new FixedRules(unitRules({ hbTimeoutMs: 15_000 }))).intervalMs).toBe(5_000);   // a short test timeout sweeps faster
  });
  it('survives cache acquisition and release outages, then resumes sweeping', async () => {
    const cache = { tryLock: vi.fn().mockRejectedValueOnce(new Error('cache down')).mockResolvedValue(true), releaseLock: vi.fn().mockRejectedValue(new Error('release down')) };
    const bus = { execute: vi.fn().mockRejectedValueOnce(new Error('database down')).mockResolvedValue({ ended: 0, skipped: 0 }) };
    const scheduler = new StaleRideScheduler(bus as never, new FixedRules(unitRules({ hbTimeoutMs: 150_000 })), cache as never);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(bus.execute).not.toHaveBeenCalled();
    expect(cache.releaseLock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cache.releaseLock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(bus.execute).toHaveBeenCalledTimes(2);
    scheduler.onApplicationShutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

});
