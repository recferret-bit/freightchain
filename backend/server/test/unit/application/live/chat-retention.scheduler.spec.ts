import { ChatRetentionScheduler } from '../../../../src/application/live/chat-retention.scheduler.js';

describe('ChatRetentionScheduler', () => {
  it('purges replay chat when it holds the lock, and skips when it does not', async () => {
    let purged = 0;
    const chat = { purge: async () => { purged += 1; return 2; } };
    const held = new ChatRetentionScheduler(chat as never, { tryLock: async () => true, releaseLock: async () => undefined } as never);
    expect(await held.run()).toBe(2);
    held.onApplicationShutdown();
    expect(purged).toBe(1);
    const skipped = new ChatRetentionScheduler(chat as never, { tryLock: async () => false, releaseLock: async () => undefined } as never);
    expect(await skipped.run()).toBe(0);
    skipped.onApplicationShutdown();
    expect(purged).toBe(1);
  });
});
