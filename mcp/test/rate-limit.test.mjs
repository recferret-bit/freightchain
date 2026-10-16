import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../src/rate-limit.js';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';

test('local limits are per IP and cardinality pressure never clears an existing budget', async () => {
  let ms = 0;
  const limiter = createLimiter({ rps: 2, now: () => ms });
  assert.equal(await limiter.allowed('a'), true);
  assert.equal(await limiter.allowed('a'), true);
  assert.equal(await limiter.allowed('a'), false);
  for (let i = 0; i < 10001; i++) await limiter.allowed(`other-${i}`);
  assert.equal(await limiter.allowed('a'), false);
  ms = 1001;
  assert.equal(await limiter.allowed('a'), true);
  assert.equal(await limiter.allowed('b'), true);
});

test('Redis limits share counters across instances and fail closed on error', async () => {
  const hits = new Map(), keys = [];
  const redis = { on() {}, async eval(script, n, key) { assert.match(script, /PEXPIRE/); assert.equal(n, 1); keys.push(key); const hit = (hits.get(key) ?? 0) + 1; hits.set(key, hit); return hit; } };
  const a = createLimiter({ rps: 2, redis }), b = createLimiter({ rps: 2, redis });
  assert.equal(await a.allowed('a'), true);
  assert.equal(await b.allowed('a'), true);
  assert.equal(await a.allowed('a'), false);
  assert.equal(await b.allowed('b'), true);
  assert.match(keys[0], /^fc:mcp-rl:[a-f0-9]{64}$/);
  redis.eval = async () => { throw new Error('unavailable'); };
  assert.equal(await b.allowed('fresh-ip'), false);
  assert.throws(() => createLimiter({ rps: 2, production: true }), /REDIS_URL/);
});

test('real Redis: restricted URL authentication and atomic shared limits', { skip: !process.env.TEST_REDIS_URL }, async () => {
  const url = new URL(process.env.TEST_REDIS_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'use a throwaway local Redis');
  const admin = new Redis(url.href), token = `test/:#?${randomUUID()}`;
  await admin.acl('SETUSER', 'fc-mcp', 'on', `>${token}`, '~fc:mcp-rl:*', '+eval', '+incr', '+pexpire', '+pttl', '+ping', '+quit', '+client|setinfo');
  url.username = 'fc-mcp'; url.password = '';
  const a = createLimiter({ url: url.href, token, rps: 2, production: true }), b = createLimiter({ url: url.href, token, rps: 2, production: true });
  try {
    for (let i = 0; i < 50 && !(await a.ready() && await b.ready()); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(await a.ready(), true); assert.equal(await b.ready(), true);
    const ip = randomUUID();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).allowed(ip)));
    assert.equal(results.filter(Boolean).length, 2);
    assert.equal(await b.allowed(randomUUID()), true);
  } finally { await a.close(); await b.close(); await admin.acl('DELUSER', 'fc-mcp'); await admin.quit(); }
});
