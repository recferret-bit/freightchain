import assert from 'node:assert/strict';
import { before, after, describe, test } from 'node:test';
import { openPitch } from '../../harness/sessions/pitch.mjs';

describe('block 1 pitch deck', { concurrency: 1 }, () => {
  let page;
  before(async () => { page = await openPitch(); });
  after(() => page?.close());

  test('B1-DECK-01 first slide is showing', () => {
    assert.equal(page.view.cur, 0);
    assert.ok(page.document.querySelectorAll('.slide').length >= 2);
  });

  test('B1-DECK-02 #next advances', () => {
    page.document.getElementById('next').click();
    assert.equal(page.view.cur, 1);
  });

  test('B1-DECK-03 #prev goes back', () => {
    page.document.getElementById('prev').click();
    assert.equal(page.view.cur, 0);
  });

  test('B1-DECK-04 help-bar next arrow', () => {
    page.document.querySelector('#help [data-go="1"]').click();
    assert.equal(page.view.cur, 1);
  });

  test('B1-DECK-05 ArrowRight key', () => {
    const cur = page.view.cur;
    page.window.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(page.view.cur, cur + 1);
  });

  test('B1-DECK-06 Home key returns to the first slide', () => {
    page.window.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    assert.equal(page.view.cur, 0);
  });

  test('B1-DECK-07 #fs is the fullscreen control', () => {
    const fs = page.document.getElementById('fs');
    assert.ok(fs);
    fs.click();
    const hint = page.document.getElementById('fs-hint');
    assert.equal(hint.hidden, false);
  });

  test('B1-DECK-08 #fs-hint click hides the hint', () => {
    page.document.getElementById('fs-hint').click();
    assert.equal(page.document.getElementById('fs-hint').hidden, true);
  });

  test('B1-DECK-09 #tilt stays hidden without a phone', () => {
    assert.equal(page.document.getElementById('tilt').hidden, true);
    assert.ok(page.document.getElementById('tilt-yes'));
    assert.ok(page.document.getElementById('tilt-no'));
  });

  test('B1-DECK-10 #turn-skip click does not throw', () => {
    page.document.getElementById('turn-skip').click();
    assert.equal(page.document.getElementById('turn').hidden, true);
  });

  test('B1-DECK-11 slide controls that exist receive a click', () => {
    const selectors = ['.pts li.don', '.pts li.adopt', '.ladder li', '.exits .exit', '.split > div', '#ticker'];
    let clicked = 0;
    for (const sel of selectors) {
      const el = page.document.querySelector(sel);
      if (!el) continue;
      el.click();
      clicked += 1;
    }
    assert.ok(clicked >= 1, 'expected at least one in-slide control');
  });
});
