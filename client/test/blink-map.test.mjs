import assert from 'node:assert/strict';
import test from 'node:test';
import { mapRule, resolveHref, unwrap } from '../site/blink-map.js';

const RULES = [{ pathPattern: '/', apiPath: '/api/actions/shift' }, { pathPattern: '/r/**', apiPath: '/api/actions/ride/**' }, { pathPattern: '/api/actions/**', apiPath: '/api/actions/**' }];

test('unwrap: an action URL, a dial.to interstitial, or a site page – nothing else', () => {
  assert.deepEqual(unwrap('solana-action:https://freightchain.fun/api/actions/shift'), { api: 'https://freightchain.fun/api/actions/shift' });
  assert.deepEqual(unwrap(`https://dial.to/?action=${encodeURIComponent('solana-action:https://freightchain.fun/api/actions/ride/r1')}&cluster=devnet`), { api: 'https://freightchain.fun/api/actions/ride/r1' });
  assert.deepEqual(unwrap(' https://freightchain.fun/r/r1 '), { site: 'https://freightchain.fun/r/r1' });
  assert.equal(unwrap('javascript:alert(1)'), null);
  assert.equal(unwrap('solana-action:file:///etc/passwd'), null);
  assert.equal(unwrap('not a url'), null);
});

test('mapRule: our actions.json maps the landing and a ride page, keeps the query, and is idempotent for the API', () => {
  assert.equal(mapRule(RULES, 'https://freightchain.fun/'), 'https://freightchain.fun/api/actions/shift');
  assert.equal(mapRule(RULES, 'https://freightchain.fun/r/abc-1?x=1'), 'https://freightchain.fun/api/actions/ride/abc-1?x=1');
  assert.equal(mapRule(RULES, 'https://ride.freightchain.fun/'), 'https://ride.freightchain.fun/api/actions/shift');
  assert.equal(mapRule(RULES, 'https://freightchain.fun/api/actions/go/home'), 'https://freightchain.fun/api/actions/go/home');
  assert.equal(mapRule(RULES, 'https://freightchain.fun/lobby.html'), null);
  assert.equal(mapRule([{ pathPattern: '/donate/*', apiPath: 'https://api.example.com/v1/donate/*' }], 'https://example.com/donate/5'), 'https://api.example.com/v1/donate/5');
  assert.equal(mapRule([{ pathPattern: '/trade/*', apiPath: '/api/trade/*' }], 'https://example.com/trade/1/2'), null, '* is one segment');
});

test('resolveHref: relative hrefs land on the action API origin', () => {
  assert.equal(resolveHref('/api/actions/go/home', 'https://ride.freightchain.fun/api/actions/shift'), 'https://ride.freightchain.fun/api/actions/go/home');
  assert.equal(resolveHref('https://other.example/x', 'https://freightchain.fun/api/actions/shift'), 'https://other.example/x');
});
