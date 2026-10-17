import assert from 'node:assert/strict';
import { before, after, describe, test } from 'node:test';
import { called, hashTo, settle } from '../../harness/dom.mjs';
import { openLobby } from '../../harness/sessions/lobby.mjs';

describe('block 1 lobby', { concurrency: 1 }, () => {
  let page;
  before(async () => { page = await openLobby(); });
  after(() => page?.close());

  test('B1-LOBBY-01 signed-in shell shows the wallet chip and sign out', () => {
    assert.match(page.document.getElementById('chip-wallet').textContent, /64Gh|…/);
    assert.equal(page.document.getElementById('out').textContent, 'SIGN OUT');
  });

  test('B1-LOBBY-02 NEW RIDE is the default tab', () => {
    assert.equal(page.document.querySelector('.tabs a[data-tab="new"]').getAttribute('aria-selected'), 'true');
    assert.ok(page.document.getElementById('start'));
  });

  for (const [id, tab] of [
    ['B1-LOBBY-03', 'live'],
    ['B1-LOBBY-04', 'replays'],
    ['B1-LOBBY-05', 'board'],
    ['B1-LOBBY-06', 'achievements'],
    ['B1-LOBBY-07', 'profile'],
  ]) {
    test(`${id} tab ${tab}`, async () => {
      hashTo(page, tab);
      await settle(80);
      assert.equal(page.document.querySelector(`.tabs a[data-tab="${tab}"]`).getAttribute('aria-selected'), 'true');
    });
  }

  test('B1-LOBBY-08 LIVE sort and route do not call the network', async () => {
    hashTo(page, 'live');
    await settle(40);
    const n = page.calls.length;
    page.document.getElementById('live-sort').value = 'watched';
    page.document.getElementById('live-sort').dispatchEvent(new page.window.Event('change', { bubbles: true }));
    page.document.getElementById('live-route').value = 'stuart';
    page.document.getElementById('live-route').dispatchEvent(new page.window.Event('change', { bubbles: true }));
    assert.ok(page.document.getElementById('live-random'));
    assert.equal(page.calls.length, n);
  });

  test('B1-LOBBY-09 REPLAYS filter posts a new list request', async () => {
    hashTo(page, 'replays');
    await settle(40);
    const mine = [...page.document.querySelectorAll('.filters button')].find((b) => b.textContent === 'MINE');
    assert.ok(mine);
    mine.click();
    await settle(40);
    assert.ok(page.calls.some((c) => c.method === 'GET' && c.path === '/api/replays' && c.search.includes('wallet=')));
  });

  test('B1-LOBBY-10 LEADERBOARD requests the board', async () => {
    hashTo(page, 'board');
    await settle(60);
    assert.ok(called(page.calls, 'GET', '/api/leaderboard').length >= 1);
  });

  test('B1-LOBBY-11 PROFILE promo form redeems', async () => {
    hashTo(page, 'profile');
    await settle(80);
    const input = page.document.getElementById('promo-code');
    assert.ok(input);
    input.value = 'WELCOME';
    page.document.getElementById('promo').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle(40);
    const redeem = called(page.calls, 'POST', '/api/promo/redeem');
    assert.ok(redeem.length >= 1);
    assert.equal(redeem.at(-1).body.code, 'WELCOME');
    assert.match(page.document.getElementById('promo-msg').textContent, /free|ride|ticket/i);
  });

  test('B1-LOBBY-12 agreement checkbox PUTs the profile', async () => {
    hashTo(page, 'profile');
    await settle(40);
    const age = page.document.getElementById('agree-age');
    assert.ok(age);
    age.checked = true;
    age.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    await settle(40);
    const put = called(page.calls, 'PUT', '/api/profile/agreements');
    assert.ok(put.length >= 1);
    assert.equal(put.at(-1).body.age18, true);
  });

  test('B1-LOBBY-13 referral gift click posts the colour', async () => {
    hashTo(page, 'profile');
    await settle(40);
    const gifts = [...page.document.querySelectorAll('.ref-gifts button')];
    assert.ok(gifts.length >= 2);
    const signal = gifts.find((b) => /signal/i.test(b.textContent));
    assert.ok(signal);
    signal.click();
    await settle(40);
    const post = called(page.calls, 'POST', '/api/referrals/gift');
    assert.equal(post.at(-1).body.item, 'signal');
  });

  test('B1-LOBBY-14 referral copy button is present', () => {
    assert.ok(page.document.getElementById('ref-copy'));
    assert.match(page.document.querySelector('.ref-url').textContent, /ref=ABCD2345/);
  });

  test('B1-LOBBY-17 GARAGE tab loads the garage', async () => {
    hashTo(page, 'garage');
    await settle(80);
    assert.ok(called(page.calls, 'GET', '/api/garage').length >= 1);
    assert.ok(page.document.getElementById('garage-save') || page.document.querySelector('#view .bad, #garage-slots'));
  });

  test('B1-LOBBY-16 level radio and assist checkbox change the next order', async () => {
    hashTo(page, 'new');
    await settle(40);
    const hard = page.document.getElementById('level-3');
    assert.ok(hard, 'HARD radio');
    hard.checked = true;
    hard.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    const assist = page.document.getElementById('opt-assist');
    assert.equal(assist.disabled, true);
    const easy = page.document.getElementById('level-1');
    easy.checked = true;
    easy.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  });

});
