/** A small shared cache for read-heavy public numbers and cross-replica coordination locks (Redis in production, in-process when REDIS_URL is unset). Values are JSON; a failing backend is a MISS, never an error. */
export abstract class CachePort {
  abstract get<T>(key: string): Promise<T | null>;
  abstract set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  abstract del(...keys: string[]): Promise<void>;
  /** 'redis' | 'memory' – for the boot log and the admin page */
  abstract readonly kind: string;

  /** Acquires a short-lived distributed lease in Redis (`SET NX PX`); fails open (`true`) in single-instance mode or when Redis is unreachable. */
  async tryLock(_key: string, _ttlMs: number): Promise<boolean> {
    return true;
  }

  /** Releases a distributed lease acquired via `tryLock`. */
  async releaseLock(_key: string): Promise<void> {}
}
