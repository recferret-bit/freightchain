import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignSteps, telegramUrl, xPostId } from '../site/campaign.js';
test('campaign accepts only real X post URLs or numeric IDs', () => {
  assert.equal(xPostId('https://x.com/ada/status/123?s=20'), '123');
  assert.equal(xPostId(' 123 '), '123');
  for (const value of ['https://evil.test/ada/status/123', 'http://x.com/ada/status/123', 'https://x.com/ada/status/123/more', 'https://x.com.evil/ada/status/123', '<script>']) assert.equal(xPostId(value), null);
});
test('campaign steps require both memberships and show activity separately', () => {
  const row = { rideUnlocked: true, telegram: { bound: true, member: true, groupMember: false, active: false }, x: { bound: true, ageOk: true, followersOk: true, follows: true, quoteOk: true } };
  assert.deepEqual(campaignSteps(row).map(s => s[1]), [true, false, true, false]);
  assert.equal(telegramUrl('@FreightChain'), 'https://t.me/FreightChain');
  assert.equal(telegramUrl('-12345'), null);
  assert.equal(telegramUrl('@name/evil'), null);
});
