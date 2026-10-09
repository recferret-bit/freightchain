/** A small shared cache for read-heavy public numbers (Redis in production, in-process when REDIS_URL is unset). Values are JSON; a failing backend is a MISS, never an error. */
export abstract class CachePort {
  abstract get<T>(key: string): Promise<T | null>;
  abstract set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  abstract del(...keys: string[]): Promise<void>;
  /** 'redis' | 'memory' – for the boot log and the admin page */
  abstract readonly kind: string;
}
