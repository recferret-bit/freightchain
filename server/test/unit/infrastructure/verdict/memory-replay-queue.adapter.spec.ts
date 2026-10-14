import { MemoryReplayQueueAdapter } from '../../../../src/infrastructure/verdict/memory-replay-queue.adapter.js';

describe('MemoryReplayQueueAdapter', () => {
  it('enqueues, deduplicates by rideId, prioritizes paid rides ahead of free rides, and acknowledges', async () => {
    const q = new MemoryReplayQueueAdapter();
    expect(q.kind).toBe('memory');

    expect(await q.enqueue({ rideId: 'r-free', replayId: 'rep-1', isPaid: false, enqueuedAt: 100 })).toBe(true);
    expect(await q.enqueue({ rideId: 'r-free', replayId: 'rep-2', isPaid: false, enqueuedAt: 105 })).toBe(false);
    expect(await q.enqueue({ rideId: 'r-paid', replayId: 'rep-3', isPaid: true, enqueuedAt: 200 })).toBe(true);
    expect(await q.depth()).toBe(2);

    const batch = await q.dequeueBatch(2);
    expect(batch.map((j) => j.rideId)).toEqual(['r-paid', 'r-free']);
    expect(batch[1]?.replayId).toBe('rep-2');
    expect(await q.depth()).toBe(2); // still inflight

    await q.acknowledge('r-paid', 'rep-3');
    expect(await q.depth()).toBe(1);

    await q.release(batch[1]!, 'transient');
    expect(await q.depth()).toBe(1);

    const reBatch = await q.dequeueBatch(2);
    expect(reBatch).toHaveLength(1);
    expect(reBatch[0]?.rideId).toBe('r-free');

    q.clear();
    expect(await q.depth()).toBe(0);
  });
});
