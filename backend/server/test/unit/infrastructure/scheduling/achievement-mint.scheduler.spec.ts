import { afterEach, beforeEach, vi } from 'vitest';
import { MintAchievementsCommand } from '../../../../src/application/use-cases/achievements/mint-achievements/mint-achievements.command.js';
import { AchievementMintScheduler } from '../../../../src/infrastructure/scheduling/achievement-mint.scheduler.js';
import { busMock } from '../../../support/bus.js';

describe('AchievementMintScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const env = (over: Record<string, unknown> = {}) => ({ achievementMintSecret: 'k'.repeat(64), achievementTree: 'T'.repeat(40), achievementCollection: 'C'.repeat(40), achievementMintIntervalMs: 60_000, achievementMintDelayMs: 3_600_000, achievementMintBatch: 7, ...over }) as never;
  const pass = { enabled: true, minter: 'M', queued: 0, minted: 0, skipped: 0, waiting: 0, failed: 0, retried: 0 };

  it('runs a pass on boot (with the delay and batch from the env) and then every interval', async () => {
    const { bus, sent } = busMock(pass);
    const s = new AchievementMintScheduler(bus as never, env());
    s.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(MintAchievementsCommand);
    expect(sent[0]).toMatchObject({ delayMs: 3_600_000, batch: 7, retry: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(2);
    s.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sent).toHaveLength(2);
  });

  it('is off without the key, the tree, the collection, or with the interval at 0', async () => {
    for (const over of [{ achievementMintSecret: undefined }, { achievementTree: undefined }, { achievementCollection: undefined }, { achievementMintIntervalMs: 0 }]) {
      const { bus, sent } = busMock(pass);
      const s = new AchievementMintScheduler(bus as never, env(over));
      expect(s.enabled).toBe(false);
      s.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(sent).toHaveLength(0);
    }
  });

  it('a failed pass is logged and the next one still runs', async () => {
    let calls = 0;
    const bus = { execute: async () => { if (++calls === 1) throw new Error('rpc down'); return pass; } };
    const s = new AchievementMintScheduler(bus as never, env());
    s.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2);
    s.onApplicationShutdown();
  });
});
