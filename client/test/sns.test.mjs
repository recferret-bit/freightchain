import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDriver,
  shortAddr,
  normalizeSnsDomain,
  LruCache,
  reverseCache,
  forwardCache,
  seedSns,
  seedSnsBatch,
  getCachedSns,
  clearSnsCache,
  reverseResolveSns,
  resolveSns,
  reverseResolveBatch,
  bindDriver,
  POSITIVE_TTL_MS,
  NEGATIVE_TTL_MS,
} from '../site/sns.js';

const SAMPLE_WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const SAMPLE_WALLET_2 = '64GheTAtcPoz6Re29qwWxzKU2gtZCTF6gC1NBPVgaL2N';

test('formatDriver returns sns domain when present', () => {
  assert.equal(formatDriver(SAMPLE_WALLET, 'driver.sol'), 'driver.sol');
  assert.equal(formatDriver(SAMPLE_WALLET, '  alice.sol  '), 'alice.sol');
  assert.equal(formatDriver(null, 'truck.sol'), 'truck.sol');
  assert.equal(formatDriver(undefined, 'truck.sol'), 'truck.sol');
});

test('formatDriver falls back to shortAddr when sns is absent or empty', () => {
  assert.equal(formatDriver(SAMPLE_WALLET, null), '7xKX…gAsU');
  assert.equal(formatDriver(SAMPLE_WALLET, undefined), '7xKX…gAsU');
  assert.equal(formatDriver(SAMPLE_WALLET, ''), '7xKX…gAsU');
  assert.equal(formatDriver(SAMPLE_WALLET, '   '), '7xKX…gAsU');
});

test('formatDriver handles edge case wallet inputs gracefully', () => {
  assert.equal(formatDriver('shortaddr', null), 'shortaddr');
  assert.equal(formatDriver('', null), '');
  assert.equal(formatDriver(null, null), '');
  assert.equal(formatDriver(undefined, undefined), '');
  assert.equal(formatDriver({}, null), '');
  assert.equal(formatDriver(123456789012345, null), '1234…2345');
});

test('normalizeSnsDomain standardizes domain formats', () => {
  assert.equal(normalizeSnsDomain('driver.sol'), 'driver.sol');
  assert.equal(normalizeSnsDomain('  DRIVER.SOL  '), 'driver.sol');
  assert.equal(normalizeSnsDomain('truck'), 'truck.sol');
  assert.equal(normalizeSnsDomain('truck.'), 'truck.sol');
  assert.equal(normalizeSnsDomain(''), '');
  assert.equal(normalizeSnsDomain(null), '');
  assert.equal(normalizeSnsDomain(123), '');
});

test('LruCache manages capacity and LRU eviction', () => {
  const cache = new LruCache(3, 60000);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.size, 3);

  // Access 'a' to make it most recently used
  assert.equal(cache.get('a'), 1);

  // Insert 'd', which should evict oldest ('b')
  cache.set('d', 4);
  assert.equal(cache.size, 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.get('d'), 4);
});

test('LruCache respects TTL expiration', () => {
  const cache = new LruCache(10, 50); // 50ms TTL
  cache.set('temp', 'value');
  assert.equal(cache.get('temp'), 'value');
  assert.equal(cache.has('temp'), true);

  // Manually modify entry expiresAt to test expiration logic
  const entry = cache.map.get('temp');
  entry.expiresAt = Date.now() - 1;

  assert.equal(cache.get('temp'), undefined);
  assert.equal(cache.has('temp'), false);
});

test('seedSns and seedSnsBatch prime positive and negative caches', () => {
  clearSnsCache();

  seedSns(SAMPLE_WALLET, 'pilot.sol');
  assert.equal(getCachedSns(SAMPLE_WALLET), 'pilot.sol');
  assert.equal(forwardCache.get('pilot.sol'), SAMPLE_WALLET);

  seedSns(SAMPLE_WALLET_2, null);
  assert.equal(getCachedSns(SAMPLE_WALLET_2), null);

  seedSnsBatch([
    { wallet: 'wallet11111111111111111111111111111111111111', sns: 'one.sol' },
    { wallet: 'wallet22222222222222222222222222222222222222', sns: null },
  ]);
  assert.equal(getCachedSns('wallet11111111111111111111111111111111111111'), 'one.sol');
  assert.equal(getCachedSns('wallet22222222222222222222222222222222222222'), null);

  clearSnsCache();
  assert.equal(getCachedSns(SAMPLE_WALLET), undefined);
});

test('reverseResolveSns returns cached results without network call', async () => {
  clearSnsCache();
  seedSns(SAMPLE_WALLET, 'cached.sol');

  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('should not be called');
  };

  try {
    const res = await reverseResolveSns(SAMPLE_WALLET);
    assert.equal(res, 'cached.sol');
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    clearSnsCache();
  }
});

test('reverseResolveSns queries endpoint and caches result', async () => {
  clearSnsCache();
  let requestedUrl = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ wallet: SAMPLE_WALLET, domain: 'resolved.sol' }),
    };
  };

  try {
    const res = await reverseResolveSns(SAMPLE_WALLET);
    assert.equal(res, 'resolved.sol');
    assert.match(requestedUrl, /\/api\/sns\/reverse\?wallet=/);
    assert.equal(getCachedSns(SAMPLE_WALLET), 'resolved.sol');
    assert.equal(forwardCache.get('resolved.sol'), SAMPLE_WALLET);
  } finally {
    globalThis.fetch = originalFetch;
    clearSnsCache();
  }
});

test('reverseResolveSns coalesces concurrent in-flight requests', async () => {
  clearSnsCache();
  let fetchCallCount = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    fetchCallCount++;
    await new Promise((r) => setTimeout(r, 10));
    return {
      ok: true,
      status: 200,
      json: async () => ({ wallet: SAMPLE_WALLET, domain: 'coalesced.sol' }),
    };
  };

  try {
    const [res1, res2] = await Promise.all([
      reverseResolveSns(SAMPLE_WALLET),
      reverseResolveSns(SAMPLE_WALLET),
    ]);
    assert.equal(res1, 'coalesced.sol');
    assert.equal(res2, 'coalesced.sol');
    assert.equal(fetchCallCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearSnsCache();
  }
});

test('reverseResolveSns handles negative responses and errors gracefully', async () => {
  clearSnsCache();
  const originalFetch = globalThis.fetch;

  // 1. 200 with domain: null
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ wallet: SAMPLE_WALLET, domain: null }),
  });

  const resNull = await reverseResolveSns(SAMPLE_WALLET);
  assert.equal(resNull, null);
  assert.equal(getCachedSns(SAMPLE_WALLET), null);

  clearSnsCache();

  // 2. 404 Not Found
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({}),
  });

  const res404 = await reverseResolveSns(SAMPLE_WALLET);
  assert.equal(res404, null);
  assert.equal(getCachedSns(SAMPLE_WALLET), null);

  clearSnsCache();

  // 3. Network error / throw
  globalThis.fetch = async () => {
    throw new Error('Network failure');
  };

  const resErr = await reverseResolveSns(SAMPLE_WALLET);
  assert.equal(resErr, null);
  // Network failures do not poison cache
  assert.equal(getCachedSns(SAMPLE_WALLET), undefined);

  // 4. Invalid wallet length
  assert.equal(await reverseResolveSns('too-short'), null);

  globalThis.fetch = originalFetch;
  clearSnsCache();
});

test('resolveSns forward-resolves domain to wallet address', async () => {
  clearSnsCache();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ domain: 'forward.sol', wallet: SAMPLE_WALLET }),
  });

  try {
    const res = await resolveSns('forward.sol');
    assert.equal(res, SAMPLE_WALLET);
    assert.equal(forwardCache.get('forward.sol'), SAMPLE_WALLET);
  } finally {
    globalThis.fetch = originalFetch;
    clearSnsCache();
  }
});

test('reverseResolveBatch resolves multiple wallets with concurrency', async () => {
  clearSnsCache();
  const originalFetch = globalThis.fetch;

  const wallets = [
    '11111111111111111111111111111111',
    '22222222222222222222222222222222',
    '33333333333333333333333333333333',
  ];

  globalThis.fetch = async (url) => {
    const u = new URL(url, 'http://localhost');
    const w = u.searchParams.get('wallet');
    return {
      ok: true,
      status: 200,
      json: async () => ({ wallet: w, domain: `${w.slice(0, 4)}.sol` }),
    };
  };

  try {
    const results = await reverseResolveBatch(wallets, { concurrency: 2 });
    assert.equal(results.get('11111111111111111111111111111111'), '1111.sol');
    assert.equal(results.get('22222222222222222222222222222222'), '2222.sol');
    assert.equal(results.get('33333333333333333333333333333333'), '3333.sol');
  } finally {
    globalThis.fetch = originalFetch;
    clearSnsCache();
  }
});

test('bindDriver updates DOM element and performs lazy lookup', async () => {
  clearSnsCache();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ wallet: SAMPLE_WALLET, domain: 'driver.sol' }),
  });

  try {
    const el = { textContent: '', title: '', isConnected: true };
    bindDriver(el, SAMPLE_WALLET, null);
    assert.equal(el.textContent, '7xKX…gAsU');
    assert.equal(el.title, SAMPLE_WALLET);

    // Wait for promise tick
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(el.textContent, 'driver.sol');
  } finally {
    globalThis.fetch = originalFetch;
    clearSnsCache();
  }
});
