import assert from 'node:assert/strict';
import { before, after, describe, test } from 'node:test';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { called, settle } from '../../harness/dom.mjs';
import { openLanding } from '../../harness/sessions/landing.mjs';

describe('block 1 landing', { concurrency: 1 }, () => {
  let page;
  before(async () => { page = await openLanding(); });
  after(() => page?.close());

  test('B1-LAND-01 brand links to #ride', () => {
    assert.equal(page.document.querySelector('a.brand').getAttribute('href'), '#ride');
  });

  for (const [id, href] of [
    ['B1-LAND-02', '#ride'],
    ['B1-LAND-03', '#loop'],
    ['B1-LAND-04', '#economy'],
    ['B1-LAND-05', '#roadmap'],
    ['B1-LAND-06', '#market'],
    ['B1-LAND-07', '#about'],
    ['B1-LAND-08', '#faq'],
  ]) {
    test(`${id} nav ${href}`, () => {
      const a = [...page.document.querySelectorAll('nav.nav a')].find((n) => n.getAttribute('href') === href);
      assert.ok(a, href);
      a.click();
    });
  }

  test('B1-LAND-09 #play-top unsigned goes to the EASY ride', () => {
    page.document.getElementById('play-top').click();
    assert.match(page.location.href, /\/play\.html$/);
    assert.doesNotMatch(page.location.href, /offline=1/);
  });

  test('B1-LAND-10 #connect is wired to the sign-in handler', () => {
    const btn = page.document.getElementById('connect');
    assert.equal(typeof btn.onclick, 'function');
    assert.match(btn.textContent, /CONNECT WALLET/);
  });

  test('B1-LAND-11 mock keypair sign-in posts nonce and verify', async () => {
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const provider = {
      isPhantom: true,
      publicKey: null,
      async connect() { this.publicKey = { toString: () => wallet }; return { publicKey: this.publicKey }; },
      async signMessage(msg) { return { signature: nacl.sign.detached(msg, kp.secretKey) }; },
    };
    const { signInOrFallback } = await import('../../../../frontend/client/site/wallet.js');
    const before = page.calls.length;
    await signInOrFallback(provider);
    const posts = page.calls.slice(before);
    assert.ok(posts.some((c) => c.method === 'POST' && c.path === '/api/auth/nonce'));
    const verify = posts.find((c) => c.method === 'POST' && c.path === '/api/auth/verify');
    assert.ok(verify);
    assert.equal(verify.body.wallet, wallet);
    assert.equal(typeof verify.body.signature, 'string');
  });

  test('B1-LAND-12 #play-free href is the EASY ride', () => {
    const a = page.document.getElementById('play-free');
    assert.match(a.getAttribute('href') || a.href, /\/play\.html$/);
    assert.doesNotMatch(a.href, /offline=1/);
  });

  test('B1-LAND-13 #demo-btn opens the dialog', () => {
    page.document.getElementById('demo-btn').click();
    assert.equal(page.document.getElementById('demo').open, true);
  });

  test('B1-LAND-14 #demo-x closes the dialog', () => {
    page.document.getElementById('demo-x').click();
    assert.equal(page.document.getElementById('demo').open, false);
  });

  test('B1-LAND-15 empty invite asks for a code', () => {
    const input = page.document.getElementById('invite-code');
    input.value = '';
    page.document.getElementById('invite').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.match(page.document.getElementById('invite-msg').textContent, /Type the code/);
  });

  test('B1-LAND-16 invite saves the code until a wallet connects', () => {
    page.document.getElementById('invite-code').value = 'WELCOME';
    page.document.getElementById('invite').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.match(page.document.getElementById('invite-msg').textContent, /WELCOME/);
  });

  test('B1-LAND-17 pitch deck band is a link', () => {
    assert.ok(page.document.getElementById('pitchdeck-band').getAttribute('href'));
  });

  test('B1-LAND-18 whitepaper CTA is a link', () => {
    assert.ok(page.document.getElementById('whitepaper-cta').getAttribute('href'));
  });

  test('B1-LAND-19 escrow link points at the whitepaper chapter', () => {
    assert.match(page.document.getElementById('escrow-link').getAttribute('href'), /whitepaper|onchain/);
  });

  test('B1-LAND-20 storybook footer link', () => {
    assert.match(page.document.getElementById('storybook-link').getAttribute('href'), /viewer\.html/);
  });

  test('B1-LAND-21 whitepaper footer link', () => {
    assert.ok(page.document.getElementById('whitepaper-link'));
  });

  test('B1-LAND-22 pitch deck footer link', () => {
    assert.ok(page.document.getElementById('pitchdeck-link'));
  });

  test('B1-LAND-23 FAQ question toggles', () => {
    const btn = page.document.querySelector('.fq button');
    assert.ok(btn);
    const fq = btn.closest('.fq');
    const was = fq.classList.contains('on');
    btn.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 1 }));
    assert.notEqual(fq.classList.contains('on'), was);
  });

  test('B1-LAND-24 social X link', () => {
    const a = [...page.document.querySelectorAll('a')].find((n) => /x\.com/.test(n.getAttribute('href') || ''));
    assert.ok(a);
  });

  test('B1-LAND-25 social YouTube link', () => {
    const a = [...page.document.querySelectorAll('a')].find((n) => /youtube\.com/.test(n.getAttribute('href') || ''));
    assert.ok(a);
  });

  test('B1-LAND-28 every FAQ question toggles', () => {
    const buttons = [...page.document.querySelectorAll('.fq button')];
    assert.ok(buttons.length >= 8);
    for (const btn of buttons) {
      const fq = btn.closest('.fq');
      const was = fq.classList.contains('on');
      btn.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, detail: 1 }));
      assert.notEqual(fq.classList.contains('on'), was);
    }
  });

  test('B1-LAND-29 the scroll hint points at the loop', () => {
    assert.equal(page.document.querySelector('a.scroll-hint').getAttribute('href'), '#loop');
  });

  test('B1-LAND-30 footer lobby, practice and blink links are present', () => {
    const hrefs = [...page.document.querySelectorAll('a')].map((a) => a.getAttribute('href') || '');
    assert.ok(hrefs.some((h) => h.includes('/lobby.html')));
    assert.ok(hrefs.some((h) => h.includes('/play.html')));
    assert.ok(hrefs.some((h) => h.includes('/blink.html')));
  });

  test('B1-LAND-26 boot reads the public board', async () => {
    await settle(20);
    assert.ok(called(page.calls, 'GET', '/api/me').length >= 1);
    assert.ok(called(page.calls, 'GET', '/api/pool').length >= 1);
    assert.ok(called(page.calls, 'GET', '/api/live').length >= 1);
    assert.ok(called(page.calls, 'GET', '/api/replays').length >= 1);
    assert.ok(called(page.calls, 'GET', '/api/tiers').length >= 1);
    assert.ok(called(page.calls, 'GET', '/api/leaderboard').length >= 1);
    assert.ok(called(page.calls, 'POST', '/api/auth/nonce').length >= 1);
  });
});
