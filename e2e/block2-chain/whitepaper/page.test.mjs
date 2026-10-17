import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { openPaper } from '../../harness/sessions/paper.mjs';

test('B2-PAPER-01 the whitepaper play control stays the offline guest run', async () => {
  const page = await openPaper();
  after(() => page.close());
  const play = page.document.getElementById('play-top');
  assert.match(play.getAttribute('href') || '', /offline=1/);
});
