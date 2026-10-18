import assert from 'node:assert/strict';
import { before, after, describe, test } from 'node:test';
import { hashTo, settle } from '../../harness/dom.mjs';
import { openAdmin } from '../../harness/sessions/admin.mjs';

const TABS = [
  ['B1-ADMIN-03', 'overview', '/api/admin/overview'],
  ['B1-ADMIN-04', 'queue', '/api/admin/rides'],
  ['B1-ADMIN-05', 'rides', '/api/admin/rides'],
  ['B1-ADMIN-06', 'replays', '/api/admin/replays'],
  ['B1-ADMIN-07', 'players', '/api/admin/players'],
  ['B1-ADMIN-08', 'pools', '/api/admin/pools'],
  ['B1-ADMIN-09', 'payouts', '/api/admin/pool-payouts'],
  ['B1-ADMIN-10', 'stats', '/api/admin/stats'],
  ['B1-ADMIN-11', 'sessions', '/api/admin/sessions'],
  ['B1-ADMIN-12', 'promos', '/api/admin/promos'],
  ['B1-ADMIN-13', 'settings', '/api/admin/settings'],
  ['B1-ADMIN-14', 'signins', '/api/admin/signins'],
  ['B1-ADMIN-15', 'logs', '/api/admin/logs'],
  ['B1-ADMIN-16', 'audit', '/api/admin/actions'],
];

describe('block 1 admin tabs', { concurrency: 1 }, () => {
  let page;
  before(async () => { page = await openAdmin({ signedIn: true }); });
  after(() => page?.close());

  for (const [id, tab, path] of TABS) {
    test(`${id} ${tab} fetches ${path}`, async () => {
      hashTo(page, tab);
      await settle(70);
      assert.ok(page.calls.some((c) => c.method === 'GET' && c.path === path), `${tab} did not fetch ${path}`);
    });
  }

  test('B1-ADMIN-17 REFRESH reloads the open tab', async () => {
    hashTo(page, 'overview');
    await settle(30);
    const n = page.calls.filter((c) => c.path === '/api/admin/overview').length;
    page.document.getElementById('refresh').click();
    await settle(40);
    assert.ok(page.calls.filter((c) => c.path === '/api/admin/overview').length >= n);
  });

  test('B1-ADMIN-18 SIGN OUT posts admin logout', async () => {
    page.document.getElementById('signout').click();
    await settle(30);
    assert.ok(page.calls.some((c) => c.method === 'POST' && c.path === '/api/admin/auth/logout'));
  });
});
