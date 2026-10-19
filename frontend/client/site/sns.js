/* Solana Name Service (SNS / .sol) resolution, in-memory LRU caching, and driver formatting.
   Vanilla ES module: zero external npm dependencies, pure browser standards.
   Queries server endpoints via API_BASE with credentials: 'include'. */

import { API_BASE } from '../js/hosts.js';
import { shortAddr } from './pools.js';

export { shortAddr };

export const DEFAULT_CACHE_MAX = 500;
export const POSITIVE_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const NEGATIVE_TTL_MS = 5 * 60 * 1000;  // 5 minutes
export const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Lightweight in-memory LRU cache backed by ES6 Map insertion order.
 */
export class LruCache {
  constructor(maxSize = DEFAULT_CACHE_MAX, defaultTtlMs = POSITIVE_TTL_MS) {
    this.maxSize = maxSize;
    this.defaultTtlMs = defaultTtlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh LRU recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

// Module-level caches: reverse (wallet -> domain) and forward (domain -> wallet)
export const reverseCache = new LruCache(DEFAULT_CACHE_MAX, POSITIVE_TTL_MS);
export const forwardCache = new LruCache(DEFAULT_CACHE_MAX, POSITIVE_TTL_MS);

// In-flight request deduplication maps
const inFlightReverse = new Map();
const inFlightResolve = new Map();

/**
 * Normalizes an SNS domain name to lowercase canonical format.
 * Appends '.sol' if no recognized suffix is present.
 */
export function normalizeSnsDomain(domain) {
  if (typeof domain !== 'string') return '';
  let d = domain.trim().toLowerCase();
  if (d.endsWith('.')) d = d.slice(0, -1);
  if (!d) return '';
  return d.endsWith('.sol') ? d : `${d}.sol`;
}

/**
 * Seeds the client SNS cache manually (e.g. from server-enriched DTOs).
 */
export function seedSns(wallet, domain) {
  if (!wallet || typeof wallet !== 'string') return;
  const w = wallet.trim();
  if (!w) return;
  const d = typeof domain === 'string' && domain.trim() ? normalizeSnsDomain(domain) : null;
  reverseCache.set(w, d, d ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS);
  if (d) {
    forwardCache.set(d, w, POSITIVE_TTL_MS);
  }
}

export const primeSnsCache = seedSns;

/**
 * Synchronously retrieves cached reverse lookup for wallet if present and unexpired.
 */
export function getCachedSns(wallet) {
  if (!wallet || typeof wallet !== 'string') return undefined;
  return reverseCache.get(wallet.trim());
}

/**
 * Clears in-memory caches.
 */
export function clearSnsCache() {
  reverseCache.clear();
  forwardCache.clear();
}

/**
 * Seeds client cache from a collection of items containing wallet and sns fields.
 */
export function seedSnsBatch(items) {
  if (!items || !Array.isArray(items)) return;
  for (const item of items) {
    if (item && item.wallet) {
      seedSns(item.wallet, item.sns);
    }
  }
}

/**
 * Reverse-resolves a driver wallet public key to their primary .sol domain name.
 * Returns domain string (e.g. "driver.sol") or null if unregistered, not found, or error.
 */
export async function reverseResolveSns(wallet, options = {}) {
  if (!wallet || typeof wallet !== 'string') return null;
  const key = wallet.trim();
  if (key.length < 32 || key.length > 44) return null; // Solana base58 address length check

  const cached = reverseCache.get(key);
  if (cached !== undefined) return cached;

  if (inFlightReverse.has(key)) {
    return inFlightReverse.get(key);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const promise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sns/reverse?wallet=${encodeURIComponent(key)}`, {
        credentials: 'include',
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        // Cache negative result on 4xx (not found or invalid), short negative TTL on server errors
        const ttl = res.status < 500 ? NEGATIVE_TTL_MS : 30 * 1000;
        reverseCache.set(key, null, ttl);
        return null;
      }

      const data = await res.json().catch(() => ({}));
      const domain = typeof data.domain === 'string' && data.domain.trim()
        ? normalizeSnsDomain(data.domain)
        : null;

      const ttl = domain ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
      reverseCache.set(key, domain, ttl);
      if (domain) forwardCache.set(domain, key, POSITIVE_TTL_MS);
      return domain;
    } catch {
      // Network error, offline, or timeout: fail silently to null without poisoning cache long-term
      return null;
    } finally {
      inFlightReverse.delete(key);
    }
  })();

  inFlightReverse.set(key, promise);
  return promise;
}

/**
 * Forward-resolves a .sol domain name to the owner's wallet address.
 * Returns base58 wallet address or null if nonexistent or error.
 */
export async function resolveSns(domain, options = {}) {
  if (!domain || typeof domain !== 'string') return null;
  const canonicalDomain = normalizeSnsDomain(domain);
  if (!canonicalDomain) return null;

  const cached = forwardCache.get(canonicalDomain);
  if (cached !== undefined) return cached;

  if (inFlightResolve.has(canonicalDomain)) {
    return inFlightResolve.get(canonicalDomain);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const promise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sns/resolve?domain=${encodeURIComponent(canonicalDomain)}`, {
        credentials: 'include',
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const ttl = res.status < 500 ? NEGATIVE_TTL_MS : 30 * 1000;
        forwardCache.set(canonicalDomain, null, ttl);
        return null;
      }

      const data = await res.json().catch(() => ({}));
      const wallet = typeof data.wallet === 'string' && data.wallet.trim()
        ? data.wallet.trim()
        : null;

      const ttl = wallet ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
      forwardCache.set(canonicalDomain, wallet, ttl);
      return wallet;
    } catch {
      return null;
    } finally {
      inFlightResolve.delete(canonicalDomain);
    }
  })();

  inFlightResolve.set(canonicalDomain, promise);
  return promise;
}

/**
 * Formats driver identity for UI display.
 * Returns sns if valid non-empty string; falls back cleanly to shortAddr(wallet).
 * Handles null, undefined, objects, numbers, and invalid inputs gracefully.
 */
export function formatDriver(wallet, sns) {
  if (typeof sns === 'string') {
    const s = sns.trim();
    if (s.length > 0) return s;
  }
  if (!wallet) return '';
  if (typeof wallet !== 'string') {
    if (typeof wallet === 'object') return '';
    return shortAddr(String(wallet));
  }
  const w = wallet.trim();
  return w ? shortAddr(w) : '';
}

/**
 * Resolves an array of wallet addresses in batch with bounded concurrency and caching.
 * Returns Map<string, string | null>.
 */
export async function reverseResolveBatch(wallets, options = {}) {
  if (!wallets || !Array.isArray(wallets)) return new Map();
  const concurrency = options.concurrency ?? 6;
  const resultMap = new Map();

  const unique = [...new Set(wallets.filter(w => typeof w === 'string' && w.trim()))];
  const toFetch = [];

  for (const w of unique) {
    const key = w.trim();
    const cached = reverseCache.get(key);
    if (cached !== undefined) {
      resultMap.set(key, cached);
    } else {
      toFetch.push(key);
    }
  }

  if (toFetch.length === 0) return resultMap;

  let index = 0;
  async function worker() {
    while (index < toFetch.length) {
      const current = toFetch[index++];
      try {
        const domain = await reverseResolveSns(current, options);
        resultMap.set(current, domain);
      } catch {
        resultMap.set(current, null);
      }
    }
  }

  const workerCount = Math.min(concurrency, toFetch.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return resultMap;
}

/**
 * Binds driver display to a DOM element, updating with cached domain or shortAddr,
 * and lazily resolving via reverse lookup if not already cached.
 */
export function bindDriver(element, wallet, sns) {
  if (!element) return;
  const initial = formatDriver(wallet, sns ?? getCachedSns(wallet));
  element.textContent = initial;
  if (wallet && typeof wallet === 'string') {
    element.title = wallet;
  }
  if (!sns && wallet && typeof wallet === 'string' && getCachedSns(wallet) === undefined) {
    reverseResolveSns(wallet).then(domain => {
      if (domain && element.isConnected) {
        element.textContent = domain;
      }
    }).catch(() => {});
  }
}
