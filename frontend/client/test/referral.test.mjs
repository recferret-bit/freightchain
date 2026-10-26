import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { availableText, bindStoredRef, capacityText, captureRef, GIFT_ITEMS, inviteLabel, refCode, refFromSearch, REF_KEY, searchWithoutRef, shareUrl } from '../site/referral.js';

const mem = (seed = {}) => {
  const box = { ...seed };
  return {
    box,
    get(k) { return Object.prototype.hasOwnProperty.call(box, k) ? box[k] : null; },
    set(k, v) { box[k] = v; return true; },
    remove(k) { delete box[k]; },
  };
};

test('a ref code is 8 letters or digits, uppercased', () => {
  assert.equal(refCode(' abcd2345 '), 'ABCD2345');
  assert.equal(refCode('ABCD234'), null);
  assert.equal(refCode('ABCD23456'), null);
  assert.equal(refCode('ABCD234!'), null);
  assert.equal(refCode(''), null);
});

test('?ref= is captured, and a bad one does not wipe a stored code', () => {
  const s = mem();
  assert.equal(captureRef(s, '?promo=HELLO&ref=abcd2345'), 'ABCD2345');
  assert.equal(s.get(REF_KEY), 'ABCD2345');
  assert.equal(captureRef(s, '?ref=nope'), null);
  assert.equal(s.get(REF_KEY), 'ABCD2345');
  assert.equal(captureRef(s, '?ref=ZZZZZZZ9'), 'ZZZZZZZ9');
  assert.equal(refFromSearch(''), null);
});

test('searchWithoutRef drops only ref', () => {
  assert.equal(searchWithoutRef('?promo=HELLO&ref=ABCD2345'), '?promo=HELLO');
  assert.equal(searchWithoutRef('?ref=ABCD2345'), '');
  assert.equal(searchWithoutRef('?promo=HELLO'), null);
});

test('the share link is the site origin plus ?ref=', () => {
  assert.equal(shareUrl('https://freightchain.fun', 'http://localhost', 'ABCD2345'), 'https://freightchain.fun/?ref=ABCD2345');
  assert.equal(shareUrl('', 'http://localhost:3000', 'ABCD2345'), 'http://localhost:3000/?ref=ABCD2345');
});

test('capacity is used / capacity, and available is its own number', () => {
  assert.equal(capacityText({ used: 2, capacity: 6 }), '2 / 6');
  assert.equal(availableText({ available: 3 }), '3');
  assert.equal(capacityText({ used: 1 }), '–');
  assert.equal(availableText({}), '–');
  assert.equal(availableText({ available: 1.5 }), '–');
});

test('invite status includes pending, active, qualified and expired', () => {
  assert.equal(inviteLabel('pending'), 'pending');
  assert.equal(inviteLabel('active'), 'active');
  assert.equal(inviteLabel('qualified'), 'qualified');
  assert.equal(inviteLabel('expired'), 'expired');
  assert.equal(inviteLabel('nope'), '–');
});

test('bind posts once per call, and clears the code on success or terminal 400/409', async () => {
  const posts = [];
  const api = (path, body) => { posts.push([path, body]); return Promise.resolve({}); };
  const s = mem({ [REF_KEY]: 'abcd2345' });
  assert.equal(await bindStoredRef(api, s), 'bound');
  assert.deepEqual(posts, [['referrals/bind', { code: 'ABCD2345' }]]);
  assert.equal(s.get(REF_KEY), null);

  const stuck = mem({ [REF_KEY]: 'ABCD2345' });
  const conflict = () => Promise.reject(Object.assign(new Error('taken'), { status: 409 }));
  assert.equal(await bindStoredRef(conflict, stuck), 'conflict');
  assert.equal(stuck.get(REF_KEY), null);

  const invalid = mem({ [REF_KEY]: 'IIIIIIII' });
  assert.equal(await bindStoredRef(() => Promise.reject({ status: 400 }), invalid), 'conflict');
  assert.equal(invalid.get(REF_KEY), null);

  const kept = mem({ [REF_KEY]: 'ABCD2345' });
  const down = () => Promise.reject(Object.assign(new Error('missing'), { status: 404 }));
  assert.equal(await bindStoredRef(down, kept), 'keep');
  assert.equal(kept.get(REF_KEY), 'ABCD2345');

  const junk = mem({ [REF_KEY]: 'nope' });
  assert.equal(await bindStoredRef(api, junk), 'skip');
  assert.equal(junk.get(REF_KEY), null);
  assert.equal(await bindStoredRef(api, mem()), 'skip');
});

test('the gift picker names convoy, signal and amber', () => {
  assert.deepEqual(GIFT_ITEMS, ['convoy', 'signal', 'amber']);
});

test('the lobby referral block does not put server text through innerHTML', () => {
  const src = readFileSync(new URL('../site/lobby-referral.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(src, /referrals\/gift/);
  assert.doesNotMatch(src, /['"`]\/api\//);
});
