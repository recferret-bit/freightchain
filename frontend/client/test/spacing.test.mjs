// The roadside spacing rule (js/world/spacing.js) – pure, no three.js. What chunks.js really lays out is re-checked by the headless test ("road content …").
import test from 'node:test'; import assert from 'node:assert/strict';
import { GAP, RANK, overlap, footprintOf, insideChunk, occupancy } from '../js/world/spacing.js';
const rock = (s, l, z = 1) => footprintOf('rock', { r: 1.2 * z }, s, l), sign = (s, l) => footprintOf('sign', { r: .25 }, s, l), guard = (s, l) => footprintOf('guard', { r: .3, rf: 2.1, rl: .3 }, s, l), post = (s, l) => footprintOf('post', { r: .15 }, s, l);

test('a warning sign standing inside a rock is an overlap (the bug in the intro clip)', () => { assert.ok(overlap(sign(522, 7.6), rock(523, 9.1))); assert.ok(overlap(rock(523, 9.1), sign(522, 7.6)), 'symmetric'); });
test('too close counts, a clear gap does not', () => {
  const a = rock(100, 10), edge = 1.2 + 1.2 + GAP;   // two radius-1.2 rocks
  assert.ok(overlap(a, rock(100 + edge - .01, 10))); assert.ok(!overlap(a, rock(100 + edge + .01, 10)));
  assert.ok(overlap(a, rock(100, 10 + edge - .01))); assert.ok(!overlap(a, rock(100, 10 + edge + .01)));
});
test('big rocks reach further than small ones; long guardrails reach along the road', () => {
  assert.ok(overlap(rock(0, 10, 2.5), sign(0, 14.4))); assert.ok(!overlap(rock(0, 10, .5), sign(0, 14.4)));
  assert.ok(overlap(guard(0, 6.9), rock(2.1 + 1.2 + GAP - .01, 6.9))); assert.ok(!overlap(guard(0, 6.9), rock(2.1 + 1.2 + GAP + .01, 6.9)));
});
test('furniture and signs are laid out by design: posts / rails / signs / buildings are not checked against each other, scenery is checked against all of them', () => {
  assert.ok(!overlap(post(10, 6.6), sign(10, 7.6))); assert.ok(!overlap(guard(10, 6.9), sign(10, 7.6))); assert.ok(!overlap(guard(10, 6.9), post(10, 6.6)));
  for (const f of [post(10, 6.6), guard(10, 6.9), sign(10, 7.6), footprintOf('building', { r: 3 }, 10, 12)]) assert.ok(overlap(f, rock(10, f.l)), f.kind);
  assert.ok(overlap(sign(0, 7.6), sign(1, 7.6)), 'two signs on top of each other');
});
test('every kind of the props table has a rank (a new kind must not slip past the rule)', () => {
  for (const k of ['cactus', 'bush', 'rock', 'post', 'pole', 'lamp', 'gantry', 'tree', 'termite', 'drift', 'guard', 'sign', 'building']) assert.ok(RANK[k] >= 0, k);
  assert.ok(RANK.building < RANK.guard && RANK.guard < RANK.sign && RANK.sign < RANK.rock);
});
test('occupancy: first come first served, a footprint that does not fit is refused and not recorded; unknown kinds pass', () => {
  const o = occupancy(); assert.ok(o.claim(sign(50, 7.6))); assert.ok(!o.claim(rock(51, 9))); assert.equal(o.items.length, 1); assert.ok(o.claim(rock(60, 9))); assert.equal(o.items.length, 2);
  assert.ok(o.fits({ s: 0, l: 0 })); assert.ok(o.claim({ s: 50, l: 7.6 }));
});
test('insideChunk keeps scenery inside its chunk with room for GAP, so neighbouring chunks never touch', () => {
  const s0 = 320, L = 32, rf = 1.2;
  for (const s of [s0 - 5, s0, s0 + 1, s0 + 16, s0 + 31, s0 + L, s0 + 40]) { const x = insideChunk(s, rf, s0, L); assert.ok(x - rf >= s0 + GAP && x + rf <= s0 + L - GAP, `${s} → ${x}`); }
  assert.equal(insideChunk(s0 + 16, rf, s0, L), s0 + 16, 'a spot that is already inside stays');
  const left = insideChunk(s0 + L, 3, s0, L) + 3, right = insideChunk(s0 + L, 3, s0 + L, L) - 3;   // largest rocks of two neighbouring chunks
  assert.ok(right - left >= GAP, 'neighbouring chunks: ' + (right - left));
  assert.equal(insideChunk(10, 20, 0, 32), 16, 'too big for the chunk: centred');
});
