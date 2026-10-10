import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROLS, BIT, MOUSE, lightInputs } from '../js/input-bits.js';

/* cockpit/inputs.js draws on the shared cockpit canvas: give it a recording fake of the 2D context (the module reads `document` when it is imported) */
const calls = [];
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([String(k), a]); }), set: (t, k, v) => { t[k] = v; if (k === 'strokeStyle' || k === 'fillStyle' || k === 'globalAlpha') calls.push([`set ${String(k)}`, [v]]); return true; } });
globalThis.document = { getElementById: () => ({ getContext: () => ctx, width: 0, height: 0 }) };
const { view } = await import('../js/cockpit/canvas.js');
const { uiBtns } = await import('../js/cockpit/common.js');
const { drawInputs } = await import('../js/cockpit/inputs.js');
Object.assign(view, { W: 1500, H: 1000, DPR: 1 });
const L0 = () => ({ on: true, mask: 0, key: new Float32Array(CONTROLS.length), mouse: new Float32Array(CONTROLS.length) });
const run = L => { calls.length = 0; drawInputs(L); return calls.slice(); };
const strokes = c => c.filter(([k]) => k === 'stroke').length;
const texts = c => c.filter(([k]) => k === 'fillText').map(([, a]) => a[0]);
const arcs = c => c.filter(([k]) => k === 'arc').length;

test('nothing is drawn outside a replay (the game, the landing\'s dash cards)', () => {
  assert.deepEqual(run({ ...L0(), on: false }), []);
});
test('a replay always shows the driving cluster, dim, with no yellow border while nothing is pressed', () => {
  const c = run(L0());
  assert.deepEqual(texts(c), ['Q', 'W', 'E', 'A', 'S', 'D', '⇧ CLUTCH']);
  assert.ok(!c.some(([k, a]) => k === 'set strokeStyle' && String(a[0]).startsWith('rgb(255,214,10')), 'no border');
});
test('a held key gets a yellow border on its cap, and a key outside the cluster gets a cap only while it is lit', () => {
  const L = L0();
  lightInputs(BIT.gas | BIT.night, .016, L);
  const c = run(L);
  assert.ok(c.some(([k, a]) => k === 'set strokeStyle' && a[0] === 'rgb(255,214,10)'));
  assert.ok(texts(c).includes('N'));
  assert.ok(!texts(run(L0())).includes('N'));
});
test('a dash control is outlined where the button is; a click adds the pointer and ring, a key press does not', () => {
  uiBtns.length = 0; uiBtns.push({ id: 'head', x: 100, y: 800, w: 90, h: 50 }, { id: 'cab', x: 200, y: 800, w: 90, h: 50 });
  const key = L0(); lightInputs(BIT.head, .016, key);
  const click = L0(); lightInputs(BIT.head | MOUSE, .016, click);
  const none = run(L0()), byKey = run(key), byClick = run(click);
  assert.ok(strokes(byKey) > strokes(none), 'the HEAD button is outlined');
  assert.equal(arcs(none), 0); assert.equal(arcs(byKey), 0);
  assert.equal(arcs(byClick), 1);   // the ring of the click
  assert.ok(byClick.some(([k, a]) => k === 'roundRect' && a[0] < 100 && a[1] < 800), 'a rect around the button, a little outside it');
  const cab = L0(); lightInputs(BIT.cab, .016, cab);
  assert.ok(run(cab).some(([k, a]) => k === 'roundRect' && a[0] > 190 && a[0] < 200), 'only the CAB button, not HEAD');
  uiBtns.length = 0;
});
test('COLD is outlined like the other dash buttons, and J gets a cap only while cooling is pressed', () => {
  uiBtns.length = 0;
  uiBtns.push({ id: 'heat', x: 100, y: 860, w: 53, h: 25 }, { id: 'cold', x: 160, y: 860, w: 53, h: 25 });
  const key = L0(); lightInputs(BIT.cold, .016, key);
  const click = L0(); lightInputs(BIT.cold | MOUSE, .016, click);
  const byKey = run(key), byClick = run(click);
  assert.ok(texts(byKey).includes('J'));
  assert.ok(!texts(byKey).includes('H'), 'HEAT stays dark');
  assert.ok(byKey.some(([k, a]) => k === 'roundRect' && a[0] > 150 && a[0] < 160), 'the border sits on COLD');
  assert.ok(!byKey.some(([k, a]) => k === 'roundRect' && a[0] > 90 && a[0] < 110), 'HEAT is not outlined');
  assert.equal(arcs(byClick), 1);
  uiBtns.length = 0;
});
test('a control whose button is not on the dash this frame draws no border for it (no crash)', () => {
  uiBtns.length = 0;
  const L = L0(); lightInputs(BIT.heat, .016, L);
  assert.doesNotThrow(() => run(L));
});
test('a fading light is drawn dimmer than a held one (a held one flashes between two levels, a fading one is below the bright level)', () => {
  uiBtns.length = 0; uiBtns.push({ id: 'head', x: 100, y: 800, w: 90, h: 50 });
  const border = L => Math.max(...run(L).filter(([k]) => k === 'set globalAlpha').map(([, a]) => a[0]));
  const held = L0(); lightInputs(BIT.head, .016, held);
  const fading = L0(); lightInputs(BIT.head, .016, fading); lightInputs(0, .2, fading);
  assert.ok(fading.key[CONTROLS.indexOf('head')] > 0 && fading.key[CONTROLS.indexOf('head')] < 1);
  const h = Math.max(...Array.from({ length: 8 }, () => border(held)));   // sampled across the blink
  assert.ok(border(fading) < h || h === 1, `${border(fading)} vs ${h}`);
  assert.ok(border(fading) <= .56, 'a fading light is at most its fade value');
  uiBtns.length = 0;
});
