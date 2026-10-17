import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { called } from '../../harness/dom.mjs';
import { openLanding } from '../../harness/sessions/landing.mjs';

describe('block 2 landing', { concurrency: 1 }, () => {
  let page;
  before(async () => { page = await openLanding({ paid: true, pool: true }); });
  after(() => page?.close());

  test('B2-LAND-01 a live pool paints IN ESCROW on the hero', () => {
    assert.ok(called(page.calls, 'GET', '/api/pool').length >= 1);
    assert.match(page.document.getElementById('hero-pot-lbl').textContent, /IN ESCROW/);
  });

  test('B2-LAND-02 mock keypair sign-in still posts nonce and verify beside a live pool', async () => {
    const nacl = (await import('tweetnacl')).default;
    const bs58 = (await import('bs58')).default;
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const { signInOrFallback } = await import('../../../client/site/wallet.js');
    const before = page.calls.length;
    await signInOrFallback({
      isPhantom: true,
      publicKey: null,
      async connect() { this.publicKey = { toString: () => wallet }; return { publicKey: this.publicKey }; },
      async signMessage(msg) { return { signature: nacl.sign.detached(msg, kp.secretKey) }; },
    });
    const posts = page.calls.slice(before);
    assert.ok(posts.some((c) => c.method === 'POST' && c.path === '/api/auth/nonce'));
    assert.equal(posts.find((c) => c.path === '/api/auth/verify')?.body.wallet, wallet);
  });
});
