import { afterEach, beforeEach, vi } from 'vitest';
import { PayPoolsCommand } from '../../../../src/application/use-cases/chain/pay-pools/pay-pools.command.js';
import { PoolPayoutScheduler } from '../../../../src/infrastructure/scheduling/pool-payout.scheduler.js';
import { busMock } from '../../../support/bus.js';

describe('PoolPayoutScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const env = (over: Record<string, unknown> = {}) => ({ payoutSecret: 'k'.repeat(64), ticketProgramId: 'Prog111', payoutIntervalMs: 60_000, ...over }) as never;
  const pass = { enabled: true, payout: 'P', refused: null, chainNow: 0, pools: [] };

  it('runs a pass on boot and then every PAYOUT_INTERVAL_MS', async () => {
    const { bus, sent } = busMock(pass);
    const s = new PoolPayoutScheduler(bus as never, env());
    s.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(PayPoolsCommand);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
    s.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sent).toHaveLength(2);
  });

  it('is off without PAYOUT_SECRET, without a program, or with PAYOUT_INTERVAL_MS = 0 (the CLI\'s pool:payout still works)', async () => {
    for (const over of [{ payoutSecret: undefined }, { ticketProgramId: undefined }, { payoutIntervalMs: 0 }]) {
      const { bus, sent } = busMock(pass);
      const s = new PoolPayoutScheduler(bus as never, env(over));
      expect(s.enabled).toBe(false);
      s.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(sent).toHaveLength(0);
    }
  });

  it('a failed pass is logged and the next one still runs', async () => {
    let calls = 0;
    const bus = { execute: async () => { if (++calls === 1) throw new Error('rpc down'); return pass; } };
    const s = new PoolPayoutScheduler(bus as never, env());
    s.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2);
    s.onApplicationShutdown();
  });
});

describe('PoolPayoutScheduler – a pass with failed pools', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('keeps going (the failed pools are retried by the next pass)', async () => {
    const env = { payoutSecret: 'k'.repeat(64), ticketProgramId: 'Prog111', payoutIntervalMs: 60_000 } as never;
    const { bus, sent } = busMock({ enabled: true, payout: 'P', refused: null, chainNow: 0, pools: [{ poolId: 1, state: 'error', note: 'rpc', paid: [], closed: null }] });
    const s = new PoolPayoutScheduler(bus as never, env);
    s.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(2);
    s.onApplicationShutdown();
  });
});
