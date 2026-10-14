import { afterEach, beforeEach, vi } from 'vitest';
import { ProcessReplayQueueCommand } from '../../../../src/application/use-cases/verdict/process-replay-queue/process-replay-queue.command.js';
import { ReplayVerificationScheduler } from '../../../../src/infrastructure/scheduling/replay-verification.scheduler.js';

describe('ReplayVerificationScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('polls on boot and every 5 s, skips overlapping ticks, survives errors, and stops on shutdown', async () => {
    let calls = 0;
    const bus = {
      execute: async (c: object) => {
        calls++;
        expect(c).toBeInstanceOf(ProcessReplayQueueCommand);
        if (calls === 2) throw new Error('temporary error');
        return { processed: 1, verified: 1, flagged: 0, rejected: 0 };
      },
    };
    const scheduler = new ReplayVerificationScheduler(bus as never);
    expect(scheduler.intervalMs).toBe(5_000);
    scheduler.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(2); // fails, logged
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(3); // recovers
    scheduler.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toBe(3);
  });
});
