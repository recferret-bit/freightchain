import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { apiTest, session, signInPlayer } from '../../harness/api.mjs';
import { REPO } from '../../harness/dom.mjs';

test('B2-REF-02 pool v5 has set_pool_rules and no on-chain referral pot instruction', () => {
  const lib = readFileSync(join(REPO, 'programs/freightchain_pools/src/lib.rs'), 'utf8');
  assert.match(lib, /pub fn set_pool_rules/);
  assert.doesNotMatch(lib, /fn pay_referrer/);
});

apiTest(test, 'B2-REF-01 bind still answers when the server is in program mode', async () => {
  const a = session();
  const host = await signInPlayer(a);
  const mine = await a.call('/api/referrals');
  const b = session();
  await signInPlayer(b);
  const bound = await b.call('/api/referrals/bind', { body: { code: mine.json.code } });
  assert.equal(bound.status, 200, JSON.stringify(bound.json));
  assert.equal(bound.json.referredBy, host.wallet);
});
