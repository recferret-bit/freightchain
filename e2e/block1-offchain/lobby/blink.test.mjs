import assert from 'node:assert/strict';
import { before, after, describe, test } from 'node:test';
import { settle } from '../../harness/dom.mjs';
import { openBlink } from '../../harness/sessions/blink.mjs';

describe('block 1 blink preview', { concurrency: 1 }, () => {
  let page;
  before(async () => { page = await openBlink(); });
  after(() => page?.close());

  test('B1-LOBBY-22 SHOW loads the action card', async () => {
    const input = page.document.getElementById('url');
    input.value = 'http://127.0.0.1:3411/api/actions/hello';
    page.document.getElementById('go').dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle(60);
    assert.ok(page.calls.some((c) => c.path === '/api/actions/hello'));
    assert.match(page.document.getElementById('out').textContent, /Hello|Ping/);
  });

  test('B1-LOBBY-23 CONNECT WALLET is present (extension is manual)', () => {
    assert.equal(page.document.getElementById('connect').textContent, 'CONNECT WALLET');
  });
});
