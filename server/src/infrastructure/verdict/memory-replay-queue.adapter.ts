import { ReplayQueuePort, type ReplayQueueJob } from '../../application/ports/verdict/replay-queue.port.js';

/** In-memory replay verification queue: deduplicated per rideId, prioritizes paid rides ahead of free rides. */
export class MemoryReplayQueueAdapter extends ReplayQueuePort {
  readonly kind = 'memory';
  private readonly pending = new Map<string, ReplayQueueJob>();
  private readonly inflight = new Map<string, ReplayQueueJob>();

  async enqueue(job: ReplayQueueJob): Promise<boolean> {
    if (this.inflight.has(job.rideId)) {
      this.pending.set(job.rideId, job);
      return true;
    }
    const had = this.pending.has(job.rideId);
    this.pending.set(job.rideId, job);
    return !had;
  }

  async dequeueBatch(limit: number): Promise<ReplayQueueJob[]> {
    const sorted = [...this.pending.values()].sort((a, b) => Number(b.isPaid) - Number(a.isPaid) || a.enqueuedAt - b.enqueuedAt);
    const out: ReplayQueueJob[] = [];
    for (const job of sorted) {
      if (out.length >= limit) break;
      if (this.inflight.has(job.rideId)) continue;
      this.pending.delete(job.rideId);
      this.inflight.set(job.rideId, job);
      out.push(job);
    }
    return out;
  }

  async acknowledge(rideId: string, replayId: string): Promise<void> {
    const cur = this.inflight.get(rideId);
    if (cur && cur.replayId === replayId) this.inflight.delete(rideId);
  }

  async release(job: ReplayQueueJob, _error: string): Promise<void> {
    this.inflight.delete(job.rideId);
    if (!this.pending.has(job.rideId)) this.pending.set(job.rideId, job);
  }

  async depth(): Promise<number> {
    return this.pending.size + this.inflight.size;
  }

  clear(): void {
    this.pending.clear();
    this.inflight.clear();
  }
}
