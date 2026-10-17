import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { openPitch } from '../../harness/sessions/pitch.mjs';

test('B2-DECK-01 the deck still advances when the chain routes are mounted', async () => {
  const page = await openPitch();
  after(() => page.close());
  const before = page.view.cur;
  page.document.getElementById('next').click();
  assert.equal(page.view.cur, before + 1);
  assert.equal(page.calls.filter((c) => c.path.startsWith('/api/chain') || c.path.startsWith('/api/honk')).length, 0);
});
