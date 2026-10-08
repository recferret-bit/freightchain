import { afterEach, beforeEach, vi } from 'vitest';
import { PollProgramCommand } from '../../../../src/application/use-cases/chain/poll-program/poll-program.command.js';
import { SyncPoolsCommand } from '../../../../src/application/use-cases/chain/sync-pools/sync-pools.command.js';
import { LOGS_DEBOUNCE_MS, POOL_SYNC_MS, ProgramWatcher } from '../../../../src/infrastructure/scheduling/program-watcher.js';
import { FakePoolChain } from '../../../support/fake-pool-chain.js';

const POLL = { settled: 0, skipped: 0, pendingAt: null, cursor: null, errors: [], finality: { checked: 0, finalized: 0, dropped: 0, waiting: 0 } };
const SYNC = { synced: 0, drifted: [], missing: [] };

describe('ProgramWatcher', () => {
  const INTERVAL = 15_000;
  let chain: FakePoolChain;
  beforeEach(() => { vi.useFakeTimers(); chain = new FakePoolChain(); });
  afterEach(() => vi.useRealTimers());

  /** a bus that answers both commands; a poll can be held open with `hold` */
  const setup = (interval = INTERVAL) => {
    const polls: number[] = [], syncs: number[] = [];
    let release: (() => void) | null = null;
    let hold = false;
    let fail: Error | null = null;
    const bus = {
      execute: async (c: object) => {
        if (fail) throw fail;
        if (c instanceof SyncPoolsCommand) { syncs.push(Date.now()); return SYNC; }
        if (!(c instanceof PollProgramCommand)) throw new Error('unexpected command');
        polls.push(Date.now());
        if (hold) await new Promise<void>((r) => { release = r; });
        return POLL;
      },
    };
    const watcher = new ProgramWatcher(bus as never, chain, { watchIntervalMs: interval } as never);
    return {
      watcher, polls, syncs,
      hold: (on: boolean) => { hold = on; },
      release: () => { const r = release; release = null; r?.(); },
      fail: (e: Error | null) => { fail = e; },
    };
  };

  it('interval 0 = off: no poll, no sync, no subscription', async () => {
    const { watcher, polls, syncs } = setup(0);
    watcher.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(10 * POOL_SYNC_MS);
    expect(polls).toHaveLength(0);
    expect(syncs).toHaveLength(0);
    expect(chain.listeners.size).toBe(0);
    expect(watcher.enabled).toBe(false);
  });

  it('polls and syncs on boot, then every interval / every minute', async () => {
    const { watcher, polls, syncs } = setup();
    watcher.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect([polls.length, syncs.length]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(polls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(POOL_SYNC_MS - INTERVAL);
    expect(polls).toHaveLength(5);
    expect(syncs).toHaveLength(2);
    watcher.onApplicationShutdown();
  });

  it('a websocket notification triggers an early poll, a burst of them only one', async () => {
    const { watcher, polls } = setup();
    watcher.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(chain.listeners.size).toBe(1);
    for (let i = 0; i < 5; i++) chain.emitLogs(`sig-${i}`);
    await vi.advanceTimersByTimeAsync(LOGS_DEBOUNCE_MS);
    expect(polls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(INTERVAL - 1); // the interval restarts after the early poll
    expect(polls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(polls).toHaveLength(3);
    watcher.onApplicationShutdown();
    expect(chain.listeners.size).toBe(0);
  });

  it('polls never overlap: asks during a running poll become ONE more poll right after it', async () => {
    const { watcher, polls, hold, release } = setup();
    hold(true);
    const first = watcher.poll();
    await vi.advanceTimersByTimeAsync(0);
    expect(polls).toHaveLength(1);
    void watcher.poll(); void watcher.poll(); void watcher.poll();
    await vi.advanceTimersByTimeAsync(0);
    expect(polls).toHaveLength(1); // still the first one
    hold(false);
    release();
    await first;
    expect(polls).toHaveLength(2);
    watcher.onApplicationShutdown();
  });

  it('a failed poll or sync is logged and tried again on schedule', async () => {
    const { watcher, polls, fail } = setup();
    fail(new Error('rpc down'));
    watcher.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    fail(null);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(polls).toHaveLength(1); // the failed boot poll threw before being counted; this is the retry
    watcher.onApplicationShutdown();
  });

  it('stops on shutdown', async () => {
    const { watcher, polls, syncs } = setup();
    watcher.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    watcher.onApplicationShutdown();
    chain.emitLogs('late');
    await vi.advanceTimersByTimeAsync(10 * POOL_SYNC_MS);
    expect([polls.length, syncs.length]).toEqual([1, 1]);
  });
});
