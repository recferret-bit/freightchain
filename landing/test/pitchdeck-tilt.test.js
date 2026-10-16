import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fallOnScreen } from '../src/pitchdeck/tilt.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} vs ${b}`);

test('a phone held upright drops SOL down the screen, in portrait and both landscapes', () => {
  for (const [ax, ay, angle] of [[0, 9.81, 0], [-9.81, 0, 90], [0, -9.81, 180], [9.81, 0, 270]]) {
    const f = fallOnScreen(ax, ay, angle);
    near(f.x, 0, `x @ ${angle}`); near(f.y, 1, `y @ ${angle}`);
  }
});

test('tipping rolls SOL to the low side, a flat phone leaves them, a shake stays at one g', () => {
  const right = fallOnScreen(-9.81, 0, 0); near(right.x, 1); near(right.y, 0);
  const land = fallOnScreen(0, -9.81, 90); near(land.x, 1); near(land.y, 0);   // landscape, viewport's right edge down
  const flat = fallOnScreen(0, 0, 0); near(flat.x, 0); near(flat.y, 0);
  const half = fallOnScreen(0, 4.905, 0); near(half.y, 0.5);
  const shake = fallOnScreen(-40, 0, 0); near(shake.x, 1); near(shake.y, 0);
});

test('the sensor ask is a phone-only button, off until allowed, and it is what turns tilt into gravity', () => {
  const html = read('pitchdeck.html'), js = read('src/pitchdeck.js');
  assert.match(html, /id="tilt" hidden/);
  assert.match(html, /id="tilt-yes"/);
  assert.match(js, /if \(!touch \|\| reduced \|\| !window\.isSecureContext \|\| !window\.DeviceMotionEvent\) return/);
  assert.match(js, /DeviceMotionEvent\.requestPermission\(\)/);
  assert.match(js, /setCoinGravity\(f\.x, f\.y\)/);
  assert.match(js, /interact\('tilt'\)/);
});
