export interface ReplayQueueJob {
  readonly rideId: string;
  readonly replayId: string;
  readonly isPaid: boolean;
  readonly enqueuedAt: number;
}

/** Asynchronous queue for multi-session replay verification (Redis in production when REDIS_URL is set, in-memory otherwise). */
export abstract class ReplayQueuePort {
  abstract readonly kind: 'redis' | 'memory';
  abstract enqueue(job: ReplayQueueJob): Promise<boolean>;
  abstract dequeueBatch(limit: number): Promise<ReplayQueueJob[]>;
  abstract acknowledge(rideId: string, replayId: string): Promise<void>;
  abstract release(job: ReplayQueueJob, error: string): Promise<void>;
  abstract depth(): Promise<number>;
}
