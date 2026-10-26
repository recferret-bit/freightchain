import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptLocalTestTerms } from './local-test-terms.mjs';

test('local fixture reads current versions and explicitly accepts them with its session', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, ...init });
    return Response.json({ termsVersion: 4, privacyVersion: 2, required: init.method === 'GET', acceptedTermsVersion: 4, acceptedPrivacyVersion: 2 });
  });
  assert.equal(await acceptLocalTestTerms('http://localhost:3000', 'fc=test'), 'fc=test');
  assert.deepEqual(calls.map(c => c.method), ['GET', 'POST']);
  assert.equal(calls[1].headers.cookie, 'fc=test');
  assert.deepEqual(JSON.parse(calls[1].body), { termsVersion: 4, privacyVersion: 2, age18: true, accepted: true });
});

test('already accepted fixture does not create another acceptance', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ termsVersion: 1, privacyVersion: 1, required: false }); });
  await acceptLocalTestTerms('http://127.0.0.1:3000', 'fc=test');
  assert.equal(calls, 1);
});

test('fixture refuses remote wallets before sending any request', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('must not contact a remote service'));
  await assert.rejects(acceptLocalTestTerms('https://freightchain.fun', 'fc=test'), /loopback/);
  await assert.rejects(acceptLocalTestTerms('http://localhost:3000', ''), /test wallet/);
});

test('unavailable or malformed status never silently accepts', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(acceptLocalTestTerms('http://localhost:3000', 'fc=test'), /503/);
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  await assert.rejects(acceptLocalTestTerms('http://localhost:3000', 'fc=test'), /invalid/);
});
