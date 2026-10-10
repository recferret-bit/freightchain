import test from 'node:test';
import assert from 'node:assert/strict';
import { W, H, DPR, SCENES } from '../src/dash-scenes.js';

/* the swapped-in globals each scene writes to – plain objects are enough, the scenes only assign fields */
const globals = () => ({ st: {}, dn: {}, weather: {}, wip: {}, radio: {} });
const run = (sc, t) => { const g = globals(); sc.tick(t, g); return g; };

test('every card in the markup has a scene, and every scene has a card', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const used = [...html.matchAll(/data-live="([\w-]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(used, Object.keys(SCENES).sort());
});

test('crops stay inside the cockpit canvas and are never empty', () => {
  for (const [name, { crop: [x, y, w, h] }] of Object.entries(SCENES)) {
    assert.ok(w > 0 && h > 0, `${name} has size`); assert.ok(x >= 0 && y >= 0 && x + w <= W && y + h <= H, `${name} inside ${W}×${H}`);
    assert.ok(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(w) && Number.isInteger(h), `${name} integer px`);
  }
});

test('card canvases stay small enough to be cheap (device px per card)', () => {
  for (const [name, { crop: [, , w, h] }] of Object.entries(SCENES)) assert.ok(w * DPR * h * DPR <= 700 * 500, `${name} ${w * DPR}×${h * DPR}`);
});

test('scripts are pure functions of t (same t → same state) and survive a long run', () => {
  for (const [name, sc] of Object.entries(SCENES)) for (const t of [0, 0.5, 3.3, 7.9, 61.2, 3600.4]) assert.deepEqual(run(sc, t), run(sc, t), `${name} @${t}`);
});

test('scripts only produce finite numbers', () => {
  for (const [name, sc] of Object.entries(SCENES)) for (let t = 0; t < 40; t += .37) for (const [grp, o] of Object.entries(run(sc, t)))
    for (const [k, v] of Object.entries(o)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${name}.${grp}.${k} @${t}`);
});

test('key: loops OFF → bulb check/crank → running → OFF and the loop repeats', () => {
  const k = SCENES.key, at = t => run(k, t).st;
  assert.equal(at(0).engineOn, false); assert.equal(at(0).ign, null);
  assert.ok(at(1.0).ign && at(1.0).ign.t < 1, 'bulb check phase');
  assert.ok(at(2.5).ign && at(2.5).ign.t >= 1, 'cranking phase');
  assert.equal(at(3.5).engineOn, true); assert.equal(at(3.5).ign, null);
  assert.equal(at(4.6).engineOn, false);
  assert.deepEqual(at(1.0), at(6.0), 'period is 5 s');
});

test('gear: only real gears, rpm inside the engine range, speed follows rpm', () => {
  for (let t = 0; t < 16; t += .1) { const { st } = run(SCENES.gear, t); assert.ok(st.gear >= 1 && st.gear <= 7); assert.ok(st.rpm >= 1000 && st.rpm <= 2400); assert.ok(st.v > 0); }
});

test('park: the shifter walks every gear incl. neutral and reverse', () => {
  const seen = new Set(); for (let t = 0; t < 20; t += .1) seen.add(run(SCENES.park, t).st.gear);
  for (const g of [-1, 0, 1, 2, 3, 4, 5, 6, 7]) assert.ok(seen.has(g), `gear ${g}`);
});

test('trip: radio stays on a real station index (eleven stations)', () => {
  const seen = new Set();
  for (let t = 0; t < 60; t += .5) { const { radio } = run(SCENES.trip, t); assert.equal(radio.on, true); assert.ok(Number.isInteger(radio.idx) && radio.idx >= 0 && radio.idx < 11); assert.ok(radio.song.title); seen.add(radio.idx); }
  assert.equal(seen.size, 11);
});

test('lights: night is on and the cab light / headlights both toggle', () => {
  const heads = new Set(), cabs = new Set(); for (let t = 0; t < 24; t += .25) { const { dn } = run(SCENES.lights, t); assert.equal(dn.night, true); heads.add(dn.head); cabs.add(dn.cab); }
  assert.deepEqual([...heads].sort(), [false, true]); assert.deepEqual([...cabs].sort(), [false, true]);
});
