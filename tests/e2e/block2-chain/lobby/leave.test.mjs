import assert from 'node:assert/strict';
import { test } from 'node:test';
import { called } from '../../harness/dom.mjs';
import { openLobby } from '../../harness/sessions/lobby.mjs';

test('B2-LOBBY-02 START FREE RIDE still posts a free training ride when a pool is on sale', async () => {
  const page = await openLobby({ paid: true });
  page.document.getElementById('start').click();
  await new Promise((r) => setTimeout(r, 80));
  const rides = called(page.calls, 'POST', '/api/rides');
  assert.ok(rides.length >= 1);
  assert.equal(rides.at(-1).body.tier, 'free');
  assert.match(String(page.location.href), /play\.html\?ride=/);
});
