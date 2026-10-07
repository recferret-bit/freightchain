import { afterEach, beforeEach, vi } from 'vitest';
import { GrantDailyFreeRidesCommand } from '../../../../src/application/use-cases/players/grant-daily-free-rides/grant-daily-free-rides.command.js';
import { DailyFreeRideScheduler } from '../../../../src/infrastructure/scheduling/daily-free-ride.scheduler.js';
import { busMock } from '../../../support/bus.js';
import { FakeClock } from '../../../support/fake-clock.js';

/** The fake clock starts 2036-10-08 12:00 UTC: 12 h to the next midnight. A fake timer advance moves the fake clock with it. */
describe('DailyFreeRideScheduler', () => {
  let clock: FakeClock;
  const HOUR = 3_600_000;
  const tick = async (ms: number) => { clock.ms += ms; await vi.advanceTimersByTimeAsync(ms); };
  beforeEach(() => { vi.useFakeTimers(); clock = new FakeClock(); });
  afterEach(() => vi.useRealTimers());

  it('grants on boot, then once at every UTC midnight', async () => {
    const { bus, sent } = busMock({ day: '2036-10-08', players: 2 });
    const scheduler = new DailyFreeRideScheduler(bus as never, clock);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(GrantDailyFreeRidesCommand);
    await tick(11 * HOUR);
    expect(sent).toHaveLength(1); // not yet midnight
    await tick(HOUR + 1_000);
    expect(sent).toHaveLength(2);
    await tick(24 * HOUR);
    expect(sent).toHaveLength(3);
    scheduler.onApplicationShutdown();
  });

  it('retries a failed grant in a minute instead of waiting for the next midnight', async () => {
    let calls = 0;
    const bus = { execute: async () => { if (++calls === 1) throw new Error('db down'); return { day: 'd', players: 0 }; } };
    const scheduler = new DailyFreeRideScheduler(bus as never, clock);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await tick(61_000);
    expect(calls).toBe(2);
    scheduler.onApplicationShutdown();
  });

  it('stops on shutdown', async () => {
    const { bus, sent } = busMock({ day: 'd', players: 0 });
    const scheduler = new DailyFreeRideScheduler(bus as never, clock);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.onApplicationShutdown();
    await tick(48 * HOUR);
    expect(sent).toHaveLength(1);
  });
});
