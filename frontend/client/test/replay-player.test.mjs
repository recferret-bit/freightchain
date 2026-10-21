import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMERAS, SPEEDS, SEEK_STEP, chartSeries, clampTime, deepLinkSeconds, nextCamera, seekBy, shareUrl, timelineMarks } from '../site/replay-player.js';
import { DICT, resolveLang } from '../site/i18n.js';

test('replay speeds, seek, camera and share link', () => {
  assert.deepEqual(SPEEDS, [0.5, 1, 2, 4]);
  assert.equal(SEEK_STEP, 10);
  assert.equal(seekBy(5, 10, 20), 15);
  assert.equal(seekBy(0, -10, 20), 0);
  assert.equal(seekBy(18, 10, 20), 20);
  assert.equal(clampTime('nope', 10), 0);
  assert.equal(nextCamera('cabin'), 'chase');
  assert.equal(nextCamera('hood'), 'cabin');
  assert.deepEqual(CAMERAS, ['cabin', 'chase', 'hood']);
  assert.equal(shareUrl('http://freightchain.localhost/play.html?watch=abc', 123), '/play.html?watch=abc&t=123');
  assert.equal(deepLinkSeconds('?watch=abc&t=90'), 90);
  assert.equal(deepLinkSeconds('?t=abc'), null);
});

test('timeline marks damage, honk and minigame, and the chart follows the samples', () => {
  const samples = [[0, 0, 0, 0, 10, 0, 2, 100, 0, 0, 0, 0, 12, 0, 0], [4, 10, 0, 0, 20, 0, 3, 80, 0, 0, 0, 0, 12, 4096, 0]];
  const marks = timelineMarks(samples, [{ kind: 'honk', replayT: 2 }], 8);
  assert.deepEqual(marks.map((m) => m.kind), ['start', 'damage', 'minigame', 'honk', 'finish']);
  const series = chartSeries(samples, 10);
  assert.equal(series.at(-1).v, 20);
  assert.equal(series.at(-1).hull, 80);
});

test('EN and RU dictionaries match and the language order is query, store, navigator', () => {
  assert.deepEqual(Object.keys(DICT.en).sort(), Object.keys(DICT.ru).sort());
  for (const key of Object.keys(DICT.en)) {
    assert.ok(DICT.en[key]);
    assert.ok(DICT.ru[key]);
  }
  assert.equal(resolveLang({ query: 'ru', stored: 'en', language: 'en-US' }), 'ru');
  assert.equal(resolveLang({ stored: 'ru', language: 'en-US' }), 'ru');
  assert.equal(resolveLang({ storedLegacy: 'en', language: 'ru-RU' }), 'en');
  assert.equal(resolveLang({ language: 'ru-RU' }), 'ru');
  assert.equal(resolveLang({ language: 'en-US' }), 'en');
});
