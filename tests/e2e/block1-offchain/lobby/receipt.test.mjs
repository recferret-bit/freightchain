import assert from 'node:assert/strict';
import { before, after, describe, test } from 'node:test';
import { called, settle } from '../../harness/dom.mjs';
import { openReceipt } from '../../harness/sessions/receipt.mjs';

describe('block 1 ride receipt', { concurrency: 1 }, () => {
  let page;
  before(async () => { page = await openReceipt(); });
  after(() => page?.close());

  test('B1-LOBBY-19 receipt loads the public ride', async () => {
    await settle(20);
    assert.ok(page.calls.some((c) => c.method === 'GET' && c.path.includes('/public')));
    assert.ok(page.document.getElementById('btn-take-wheel'));
  });

  test('B1-LOBBY-20 TAKE THE WHEEL navigates to play', () => {
    page.document.getElementById('btn-take-wheel').click();
    assert.match(page.location.href, /play\.html/);
  });

  test('B1-LOBBY-21 share and watch buttons exist after load', () => {
    assert.ok(page.document.getElementById('btn-share-x'));
    assert.ok(page.document.getElementById('btn-watch'));
    assert.ok(called(page.calls, 'GET', '/api/rides/11111111-1111-4111-8111-111111111111/public').length >= 1);
  });
});
