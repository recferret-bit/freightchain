import { afterEach, beforeEach, vi } from 'vitest';
import { CrankPoolsCommand } from '../../../../src/application/use-cases/chain/crank-pools/crank-pools.command.js';
import { PoolCrankScheduler } from '../../../../src/infrastructure/scheduling/pool-crank.scheduler.js';
import { busMock } from '../../../support/bus.js';

describe('PoolCrankScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const env = (over: Record<string, unknown> = {}) => ({ crankSecret: 'k'.repeat(64), ticketProgramId: 'Prog111', crankIntervalMs: 60_000, ...over }) as never;
  const pass = { enabled: true, crank: 'C', chainNow: 0, actions: [] };

  it('runs a pass on boot and then every CRANK_INTERVAL_MS', async () => {
    const { bus, sent } = busMock(pass);
    const s = new PoolCrankScheduler(bus as never, env());
    s.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(CrankPoolsCommand);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
    s.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sent).toHaveLength(2);
  });

  it('is off without CRANK_SECRET, without a program, or with CRANK_INTERVAL_MS = 0 (the CLI\'s pool:crank still works)', async () => {
    for (const over of [{ crankSecret: undefined }, { ticketProgramId: undefined }, { crankIntervalMs: 0 }]) {
      const { bus, sent } = busMock(pass);
      const s = new PoolCrankScheduler(bus as never, env(over));
      expect(s.enabled).toBe(false);
      s.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(sent).toHaveLength(0);
    }
  });

  it('a failed pass is logged and the next one still runs', async () => {
    let calls = 0;
    const bus = { execute: async () => { if (++calls === 1) throw new Error('rpc down'); return pass; } };
    const s = new PoolCrankScheduler(bus as never, env());
    s.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2);
    s.onApplicationShutdown();
  });
});
