import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { openLobby } from '../../harness/sessions/lobby.mjs';

describe('block 2 lobby', { concurrency: 1 }, () => {
  let page;
  before(async () => { page = await openLobby({ paid: true }); });
  after(() => page?.close());

  test('B2-LOBBY-01 the 1 hour tier renders a buy control when a pool is open', () => {
    const card = page.document.getElementById('tier-1h');
    assert.ok(card, 'paid tiers fixture should paint tier-1h');
    assert.match(card.textContent, /BUY/);
  });

  test('B2-LOBBY-03 the free card is still the training start, beside the paid pool', () => {
    assert.equal(page.document.getElementById('start').textContent.includes('START FREE RIDE'), true);
  });
});
