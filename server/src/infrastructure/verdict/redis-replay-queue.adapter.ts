import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { ClockPort } from '../../application/ports/shared/clock.port.js';
import { ReplayQueuePort, type ReplayQueueJob } from '../../application/ports/verdict/replay-queue.port.js';
import { MemoryReplayQueueAdapter } from './memory-replay-queue.adapter.js';

const KEY_PREFIX = 'fc:replay:';
const QUEUE_ZSET = 'zset';
const PAYLOAD_HASH = 'jobs';
const INFLIGHT_HASH = 'inflight';
const COMMAND_TIMEOUT_MS = 500;
const BREAKER_MS = 5000;

/** Redis-backed multi-worker replay verification queue (REDIS_URL set).
    Uses a sorted set ordered by priority (paid rides first, then enqueuedAt) and a payload hash so multiple worker processes can dequeue and verify sessions concurrently.
    Falls back transparently to an in-memory queue during a Redis outage (circuit breaker on ClockPort) so verification never blocks ride completion. */
export class RedisReplayQueueAdapter extends ReplayQueuePort implements OnModuleDestroy {
  readonly kind = 'redis';
  private readonly logger = new Logger(RedisReplayQueueAdapter.name);
  private readonly redis: Redis;
  private readonly fallback = new MemoryReplayQueueAdapter();
  private warned = false;
  private downUntil = 0;

  constructor(url: string, private readonly clock: ClockPort) {
    super();
    this.redis = new Redis(url, { keyPrefix: KEY_PREFIX, maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: COMMAND_TIMEOUT_MS });
    this.redis.on('error', (e: Error) => this.fail(e));
    this.redis.on('ready', () => { this.warned = false; this.downUntil = 0; this.logger.log('redis replay queue connected'); });
  }

  async enqueue(job: ReplayQueueJob): Promise<boolean> {
    if (this.isDown()) return this.fallback.enqueue(job);
    try {
      const score = (job.isPaid ? 0 : 1e13) + (job.enqueuedAt % 1e13);
      await this.redis.multi().hset(PAYLOAD_HASH, job.rideId, JSON.stringify(job)).zadd(QUEUE_ZSET, score, job.rideId).exec();
      return true;
    } catch (e) {
      this.fail(e);
      return this.fallback.enqueue(job);
    }
  }

  async dequeueBatch(limit: number): Promise<ReplayQueueJob[]> {
    if (limit <= 0) return [];
    if (this.isDown()) return this.fallback.dequeueBatch(limit);
    try {
      const popped = await this.redis.zpopmin(QUEUE_ZSET, limit);
      const rideIds: string[] = [];
      for (let i = 0; i < popped.length; i += 2) {
        const id = popped[i];
        if (id) rideIds.push(id);
      }
      if (!rideIds.length) return this.fallback.dequeueBatch(limit);
      const rawJobs = await this.redis.hmget(PAYLOAD_HASH, ...rideIds);
      const out: ReplayQueueJob[] = [];
      for (let i = 0; i < rideIds.length; i++) {
        const raw = rawJobs[i];
        if (!raw) continue;
        const job = JSON.parse(raw) as ReplayQueueJob;
        await this.redis.hset(INFLIGHT_HASH, job.rideId, raw);
        await this.redis.hdel(PAYLOAD_HASH, job.rideId);
        out.push(job);
      }
      return out;
    } catch (e) {
      this.fail(e);
      return this.fallback.dequeueBatch(limit);
    }
  }

  async acknowledge(rideId: string, replayId: string): Promise<void> {
    await this.fallback.acknowledge(rideId, replayId);
    if (this.isDown()) return;
    try {
      await this.redis.hdel(INFLIGHT_HASH, rideId);
    } catch (e) {
      this.fail(e);
    }
  }

  async release(job: ReplayQueueJob, error: string): Promise<void> {
    if (this.isDown()) {
      await this.fallback.release(job, error);
      return;
    }
    try {
      await this.redis.hdel(INFLIGHT_HASH, job.rideId);
      await this.enqueue(job);
    } catch (e) {
      this.fail(e);
      await this.fallback.release(job, error);
    }
  }

  async depth(): Promise<number> {
    const fb = await this.fallback.depth();
    if (this.isDown()) return fb;
    try {
      const [queued, inflight] = await Promise.all([this.redis.zcard(QUEUE_ZSET), this.redis.hlen(INFLIGHT_HASH)]);
      return queued + inflight + fb;
    } catch (e) {
      this.fail(e);
      return fb;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  private isDown(): boolean {
    return this.clock.now().getTime() < this.downUntil;
  }

  private fail(e: unknown): void {
    this.downUntil = this.clock.now().getTime() + BREAKER_MS;
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(`redis replay queue unavailable, falling back to memory queue: ${e instanceof Error ? e.message : String(e)}`);
  }
}
