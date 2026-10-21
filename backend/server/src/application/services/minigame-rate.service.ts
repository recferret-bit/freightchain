import { Injectable } from '@nestjs/common';
import { TooManyRequestsError } from '../../domain/shared/errors.js';

const WINDOW_MS = 60_000;
const LIMIT = 10;

/**
 * 10 minigame requests per ride per minute. The bucket is in memory, so the cap is per process, not shared across replicas. Not Redis.
 */
@Injectable()
export class MinigameRateService {
  private readonly buckets = new Map<string, { start: number; n: number }>();

  hit(rideId: string, nowMs: number): void {
    let bucket = this.buckets.get(rideId);
    if (!bucket || nowMs - bucket.start >= WINDOW_MS) {
      bucket = { start: nowMs, n: 0 };
      this.buckets.set(rideId, bucket);
    }
    if (bucket.n >= LIMIT) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.start + WINDOW_MS - nowMs) / 1000));
      throw new TooManyRequestsError('too many minigame requests', 'mg_rate_limited', retryAfterSeconds);
    }
    bucket.n += 1;
  }
}
