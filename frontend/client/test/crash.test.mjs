// Unhandled-crash reports. The hook posts only after buildReport accepts the error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, framesFromStack } from '../js/crash.js';

const STACK = `TypeError: x is undefined
    at frame (https://freightchain.fun/assets/index-abc.js:12:4)
    at https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js:9:1
    at ext (chrome-extension://abc/page.js:2:2)`;

test('a stack keeps the youngest eight frames and drops extension urls', () => {
  const frames = framesFromStack(STACK);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].function, 'frame');
  assert.equal(frames[0].filename, 'https://freightchain.fun/assets/index-abc.js');
  assert.equal(frames[0].lineno, 12);
  assert.equal(frames[1].filename.startsWith('https://cdn.jsdelivr.net/'), true);
});

test('firefox frames parse, a trailing CR still matches, and userinfo and the query are cut off', () => {
  const frames = framesFromStack('go@https://user:secret@freightchain.fun/js/main.js?x=1:8:3\r');
  assert.deepEqual(frames, [{ function: 'go', filename: 'https://freightchain.fun/js/main.js', lineno: 8, colno: 3 }]);
});

test('noise is dropped, a real error is kept once, and the page stops at three', () => {
  assert.equal(buildReport('Error', 'Script error.', '', '', 0, 0), null);
  assert.equal(buildReport('Error', 'ResizeObserver loop limit exceeded', '', 'https://freightchain.fun/a.js', 1, 1), null);
  assert.equal(buildReport('AbortError', 'The operation was aborted', '', 'https://freightchain.fun/a.js', 1, 1), null);
  assert.equal(buildReport('TypeError', 'from an extension', '    at ext (chrome-extension://abc/page.js:2:2)\r\n', '', 0, 0), null);
  const first = buildReport('Error', 'Uncaught TypeError: x is undefined https://user:secret@freightchain.fun/a.js?sig=secret', STACK, '', 0, 0);
  assert.equal(first.name, 'TypeError');
  assert.equal(first.value.includes('sig='), false);
  assert.equal(first.value.includes('user:'), false);
  assert.equal(first.value.startsWith('x is undefined https://freightchain.fun/a.js'), true);
  assert.equal(first.frames[0].function, 'frame');
  assert.equal(buildReport('TypeError', 'x is undefined', STACK, '', 0, 0), null);
  assert.ok(buildReport('RangeError', 'a', '', 'https://freightchain.fun/b.js', 2, 1));
  assert.ok(buildReport('SyntaxError', 'b', '', 'https://freightchain.fun/c.js', 3, 1));
  assert.equal(buildReport('URIError', 'c', '', 'https://freightchain.fun/d.js', 4, 1), null);
});
