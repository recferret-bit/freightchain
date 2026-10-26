import { PoolCrankScheduler } from '../../../../src/infrastructure/scheduling/pool-crank.scheduler.js';
import { PoolPayoutScheduler } from '../../../../src/infrastructure/scheduling/pool-payout.scheduler.js';
import { AchievementMintScheduler } from '../../../../src/infrastructure/scheduling/achievement-mint.scheduler.js';
import { TelemetryRetentionScheduler } from '../../../../src/infrastructure/scheduling/telemetry-retention.scheduler.js';
import { DailyFreeRideScheduler } from '../../../../src/infrastructure/scheduling/daily-free-ride.scheduler.js';
import { ChatRetentionScheduler } from '../../../../src/application/live/chat-retention.scheduler.js';
import { FakeClock } from '../../../support/fake-clock.js';
import type { CachePort } from '../../../../src/application/ports/shared/cache.port.js';
import type { CommandBus } from '@nestjs/cqrs';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

describe('Scheduler cache outage boundaries', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const env = { crankIntervalMs: 60_000, payoutIntervalMs: 60_000, achievementMintIntervalMs: 60_000, achievementMintDelayMs: 0, achievementMintBatch: 5 } as EnvService;
  const cases = [
    { name: 'pool crank', delay: 60_000, make: (bus: CommandBus, cache: CachePort) => new PoolCrankScheduler(bus, env, cache) },
    { name: 'pool payout', delay: 60_000, make: (bus: CommandBus, cache: CachePort) => new PoolPayoutScheduler(bus, env, cache) },
    { name: 'achievement mint', delay: 60_000, make: (bus: CommandBus, cache: CachePort) => new AchievementMintScheduler(bus, env, cache) },
    { name: 'telemetry retention', delay: 600_000, make: (bus: CommandBus, cache: CachePort) => new TelemetryRetentionScheduler(bus, new FakeClock(), cache) },
    { name: 'retired daily grant', delay: 60_000, make: (bus: CommandBus, cache: CachePort) => new DailyFreeRideScheduler(bus, new FakeClock(), cache) },
    { name: 'chat retention', delay: 86_400_000, make: (bus: CommandBus, cache: CachePort) => new ChatRetentionScheduler({ purge: () => bus.execute({}) } as never, cache) },
  ];

  it.each(cases)('$name contains lock acquisition/release errors, then resumes on its timer', async ({ make, delay }) => {
    const cache = { tryLock: vi.fn().mockRejectedValueOnce(new Error('cache unavailable')).mockResolvedValue(true), releaseLock: vi.fn().mockRejectedValue(new Error('release unavailable')) };
    const bus = { execute: vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue({ actions: [], pools: [], errors: [], failed: 0, deleted: 0, players: 0 }) };
    const scheduler = make(bus as unknown as CommandBus, cache as unknown as CachePort);
    await scheduler.run();
    expect(bus.execute).not.toHaveBeenCalled();
    expect(cache.releaseLock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(delay);
    expect(bus.execute).toHaveBeenCalled();
    expect(cache.releaseLock).toHaveBeenCalledTimes(1);
    const attempts = bus.execute.mock.calls.length;
    await vi.advanceTimersByTimeAsync(delay);
    expect(bus.execute.mock.calls.length).toBeGreaterThan(attempts);
    scheduler.onApplicationShutdown();
    expect(vi.getTimerCount()).toBe(0);
  });
});
