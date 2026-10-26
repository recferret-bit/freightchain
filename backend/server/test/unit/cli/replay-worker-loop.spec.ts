import { describe, expect, it, vi } from 'vitest';
import { replayWorkerLoop } from '../../../src/cli/replay-worker-loop.js';

describe('replay worker recovery', () => {
  it('retries discovery failures without spinning, then processes the durable queue', async () => {
    let stopping = false;
    const processBatch = vi.fn().mockRejectedValueOnce(new Error('database disconnected')).mockResolvedValueOnce({ processed: 1, failed: 0 }).mockImplementationOnce(async () => { stopping = true; return { processed: 0, failed: 0 }; });
    const report = vi.fn(), wait = vi.fn(async () => {});
    await replayWorkerLoop({ processBatch, report, wait, stopping: () => stopping, intervalMs: 2000 });
    expect(processBatch).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[2000], [50]]);
    expect(report.mock.calls).toEqual([[{ event: 'replay-worker.retry', error: 'database disconnected' }], [{ event: 'replay-worker.batch', processed: 1, failed: 0 }]]);
  });
  it('honors shutdown after a failed iteration without another retry or delay', async () => {
    let stopping = false;
    const processBatch = vi.fn(async () => { stopping = true; throw new Error('database disconnected'); });
    const wait = vi.fn(async () => {});
    await replayWorkerLoop({ processBatch, report: vi.fn(), wait, stopping: () => stopping, intervalMs: 2000 });
    expect(processBatch).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
  });
});
