import { afterEach, beforeEach, vi } from 'vitest';
import { PayPoolsCommand } from '../../../../src/application/use-cases/chain/pay-pools/pay-pools.command.js';
import { SyncPledgesCommand } from '../../../../src/application/use-cases/pledges/sync-pledges/sync-pledges.command.js';
import { PoolPayoutScheduler } from '../../../../src/infrastructure/scheduling/pool-payout.scheduler.js';
import { busMock } from '../../../support/bus.js';

const kinds = (sent: unknown[]) => sent.map((c) => (c instanceof PayPoolsCommand ? 'pay' : c instanceof SyncPledgesCommand ? 'pledges' : 'other'));

describe('PoolPayoutScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const env = (over: Record<string, unknown> = {}) => ({ payoutSecret: 'k'.repeat(64), ticketProgramId: 'Prog111', payoutIntervalMs: 60_000, ...over }) as never;
  const pass = { enabled: true, payout: 'P', refused: null, chainNow: 0, pools: [], errors: [] };

  it('runs a pass on boot and then every PAYOUT_INTERVAL_MS – each the payout, then the pledge job', async () => {
    const { bus, sent } = busMock(pass);
    const s = new PoolPayoutScheduler(bus as never, env());
    s.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(kinds(sent)).toEqual(['pay', 'pledges']);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(kinds(sent)).toEqual(['pay', 'pledges', 'pay', 'pledges']);
    s.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sent).toHaveLength(4);
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

  it('a failed payout pass is logged, the pledge job still runs, and the next pass still comes; a failed pledge pass stops nothing either', async () => {
    const calls: string[] = [];
    let n = 0;
    const bus = { execute: async (c: object) => {
      const k = c instanceof PayPoolsCommand ? 'pay' : 'pledges';
      calls.push(k);
      if (++n === 1 || n === 4) throw new Error('rpc down'); // the first payout pass, the second pledge pass
      return pass;
    } };
    const s = new PoolPayoutScheduler(bus as never, env());
    s.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual(['pay', 'pledges', 'pay', 'pledges', 'pay', 'pledges']);
    s.onApplicationShutdown();
  });
});

describe('PoolPayoutScheduler – a pass with failed pools / pledges', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('keeps going (the failed pools and pledges are retried by the next pass)', async () => {
    const env = { payoutSecret: 'k'.repeat(64), ticketProgramId: 'Prog111', payoutIntervalMs: 60_000 } as never;
    const { bus, sent } = busMock({ enabled: true, payout: 'P', refused: null, chainNow: 0, pools: [{ poolId: 1, state: 'error', note: 'rpc', paid: [], closed: null }], errors: [{ pledgeId: 'p', note: 'rpc' }] });
    const s = new PoolPayoutScheduler(bus as never, env);
    s.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(kinds(sent)).toEqual(['pay', 'pledges', 'pay', 'pledges']);
    s.onApplicationShutdown();
  });
});
