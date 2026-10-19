import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { called, settle } from '../../harness/dom.mjs';
import { openLobby } from '../../harness/sessions/lobby.mjs';

let page;
after(() => page?.close());

test('B1-LOBBY-18 SIGN OUT posts logout and leaves', async () => {
  page = await openLobby();
  page.document.getElementById('out').click();
  await settle(40);
  assert.ok(called(page.calls, 'POST', '/api/auth/logout').length >= 1);
  assert.match(page.location.pathname, /^\/$/);
});
