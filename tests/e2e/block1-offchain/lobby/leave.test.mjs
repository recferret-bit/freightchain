import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { called, settle } from '../../harness/dom.mjs';
import { openLobby } from '../../harness/sessions/lobby.mjs';

describe('block 1 lobby actions that leave the page', { concurrency: 1 }, () => {
  const pages = [];
  after(() => { for (const p of pages) p.close(); });

  test('B1-LOBBY-15 START FREE RIDE posts level 1 and opens the ride', async () => {
    const page = await openLobby();
    pages.push(page);
    page.document.getElementById('start').click();
    await settle(40);
    const post = called(page.calls, 'POST', '/api/rides');
    assert.equal(post.at(-1).body.tier, 'free');
    assert.equal(post.at(-1).body.level, 1);
    assert.equal(typeof post.at(-1).body.tutorial, 'boolean');
    assert.equal(typeof post.at(-1).body.assist, 'boolean');
    assert.match(page.location.href, /play\.html\?ride=/);
  });

});