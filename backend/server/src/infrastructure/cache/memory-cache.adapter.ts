import { Injectable } from '@nestjs/common';
import { CachePort } from '../../application/ports/shared/cache.port.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';

const MAX_KEYS = 5000; // bounded memory: beyond this the oldest key is forgotten

/** In-process cache (REDIS_URL unset: dev, tests, one app container). Expiry follows ClockPort, so a test moves it with the fake clock. */
@Injectable()
export class MemoryCacheAdapter extends CachePort {
  readonly kind = 'memory';
  private readonly entries = new Map<string, { json: string; until: number }>();

  constructor(private readonly clock: ClockPort) { super(); }

  async get<T>(key: string): Promise<T | null> {
    const e = this.entries.get(key);
    if (!e) return null;
    if (e.until <= this.clock.now().getTime()) { this.entries.delete(key); return null; }
    return JSON.parse(e.json) as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.entries.delete(key);
    if (this.entries.size >= MAX_KEYS) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, { json: JSON.stringify(value), until: this.clock.now().getTime() + ttlSeconds * 1000 });
  }

  /** forget everything (tests: the database behind the cache was wiped) */
  clear(): void { this.entries.clear(); }

  async del(...keys: string[]): Promise<void> {
    for (const k of keys) this.entries.delete(k);
  }
}
