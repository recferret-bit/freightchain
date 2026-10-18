import assert from 'node:assert/strict';
import { before, after, describe, test } from 'node:test';
import { openPaper } from '../../harness/sessions/paper.mjs';

describe('block 1 whitepaper', { concurrency: 1 }, () => {
  let page;
  before(async () => { page = await openPaper(); });
  after(() => page?.close());

  test('B1-PAPER-01 landing link is rewritten to this origin', () => {
    const a = page.document.getElementById('landing-top');
    assert.match(a.href, /127\.0\.0\.1:3411\/?$/);
  });

  test('B1-PAPER-02 #play-top points at the EASY ride', () => {
    const a = page.document.getElementById('play-top');
    assert.match(a.href, /\/play\.html$/);
    assert.doesNotMatch(a.href, /offline=1/);
    a.click();
    assert.match(page.location.href, /play\.html$/);
    assert.doesNotMatch(page.location.href, /offline=1/);
  });

  test('B1-PAPER-03 storybook link', () => {
    assert.match(page.document.getElementById('storybook-link').href, /viewer\.html/);
  });

  test('B1-PAPER-04 home link', () => {
    assert.ok(page.document.getElementById('home-link').href);
  });

  test('B1-PAPER-05 lobby link', () => {
    assert.match(page.document.getElementById('lobby-link').href, /lobby\.html/);
  });

  test('B1-PAPER-06 contents links are in-page anchors', () => {
    const toc = [...page.document.querySelectorAll('.toc a')];
    assert.ok(toc.length >= 3);
    assert.match(toc[0].getAttribute('href'), /^#/);
    toc[0].click();
  });
});
