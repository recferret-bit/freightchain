import { afterEach, beforeEach, vi } from 'vitest';
import { SweepTelemetryCommand } from '../../../../src/application/use-cases/telemetry/sweep-telemetry/sweep-telemetry.command.js';
import { SweepSignInsCommand } from '../../../../src/application/use-cases/auth/sweep-sign-ins/sweep-sign-ins.command.js';
import { TelemetryRetentionScheduler } from '../../../../src/infrastructure/scheduling/telemetry-retention.scheduler.js';
import { busMock } from '../../../support/bus.js';
import { FakeClock } from '../../../support/fake-clock.js';

/** The fake clock starts 2036-10-08 12:00 UTC: the next 00:30 UTC is 12.5 h away. */
describe('TelemetryRetentionScheduler', () => {
  let clock: FakeClock;
  const HOUR = 3_600_000;
  const tick = async (ms: number) => { clock.ms += ms; await vi.advanceTimersByTimeAsync(ms); };
  beforeEach(() => { vi.useFakeTimers(); clock = new FakeClock(); });
  afterEach(() => vi.useRealTimers());

  it('sweeps on boot, then every day at 00:30 UTC', async () => {
    const { bus, sent } = busMock({ cutoff: 1, deleted: 3 });
    const scheduler = new TelemetryRetentionScheduler(bus as never, clock);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(2); // the recording sweep, then the sign-in sweep
    expect(sent[0]).toBeInstanceOf(SweepTelemetryCommand);
    expect(sent[1]).toBeInstanceOf(SweepSignInsCommand);
    await tick(12 * HOUR);
    expect(sent).toHaveLength(2); // 00:00 – not yet
    await tick(HOUR / 2 + 1);
    expect(sent).toHaveLength(4); // 00:30
    await tick(24 * HOUR);
    expect(sent).toHaveLength(6);
    scheduler.onApplicationShutdown();
  });

  it('retries a failed sweep in 10 minutes; stops on shutdown', async () => {
    let calls = 0;
    const bus = { execute: async () => { if (++calls === 1) throw new Error('db down'); return { cutoff: null, deleted: 0 }; } };
    const scheduler = new TelemetryRetentionScheduler(bus as never, clock);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    await tick(10 * 60_000 + 1);
    expect(calls).toBe(3); // the retry runs both sweeps
    scheduler.onApplicationShutdown();
    await tick(48 * HOUR);
    expect(calls).toBe(3);
  });
});
