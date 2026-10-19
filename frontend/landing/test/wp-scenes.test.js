import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { W, H, DPR } from '../src/dash-scenes.js';
import { WP_SCENES } from '../src/wp-scenes.js';

/* the whitepaper's dash cards (chapter 02): same rules as the landing's – every card has a scene and the other way round, crops fit the cockpit, scripts are pure and finite */
const globals = () => ({ st: {}, dn: {}, weather: {}, wip: {}, radio: {} });
const run = (sc, t) => { const g = globals(); sc.tick(t, g); return g; };
const html = readFileSync(new URL('../whitepaper.html', import.meta.url), 'utf8');

test('every card in whitepaper.html has a scene, and every scene has a card (once)', () => {
  const used = [...html.matchAll(/data-live="([\w-]+)"/g)].map(m => m[1]);
  assert.equal(new Set(used).size, used.length, 'no scene is used twice');
  assert.deepEqual([...used].sort(), Object.keys(WP_SCENES).sort());
});

test('the first minute is nine numbered steps, in the order of a start: key, start, park brake, clutch, gear, gas, steer, brake, shift up', () => {
  const path = html.match(/<ol class="path">[\s\S]*?<\/ol>/)[0];
  assert.deepEqual([...path.matchAll(/data-live="([\w-]+)"/g)].map(m => m[1]), ['key-on', 'start', 'park', 'clutch', 'gear', 'gas', 'steer', 'brake', 'shift-up']);
});

test('cards are decorative canvases with a text footer; no inline handlers', () => {
  for (const c of html.match(/<article class="card3d"[\s\S]*?<\/article>/g)) { assert.match(c, /tabindex="0"/); assert.match(c, /<div class="img" aria-hidden="true"><\/div>/); assert.match(c, /<footer><b>[^<]+<\/b><p>[\s\S]+<\/p><\/footer>/); }
});

test('crops stay inside the cockpit canvas, are integer px and cheap enough', () => {
  for (const [name, { crop: [x, y, w, h], fit }] of Object.entries(WP_SCENES)) {
    assert.ok(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= W && y + h <= H, `${name} inside ${W}×${H}`);
    assert.ok([x, y, w, h].every(Number.isInteger), `${name} integer px`); assert.ok(w * DPR * h * DPR <= 700 * 500, `${name} ${w * DPR}×${h * DPR}`);
    if (fit === 'contain') assert.ok(w / h > 1.9, `${name} is letterboxed on purpose`); else assert.ok(w / h >= 1.2 && w / h <= 1.9, `${name} ratio ${(w / h).toFixed(2)} fits the 3:2 card without cutting much`);
  }
});

test('marks sit inside the cockpit; t0 is a plain second', () => {
  for (const [name, sc] of Object.entries(WP_SCENES)) {
    assert.ok(sc.t0 === undefined || (Number.isFinite(sc.t0) && sc.t0 >= 0), `${name} t0`);
    for (let t = 0; t < 12; t += .2) { const m = sc.mark?.(t); if (m) { const [x, y, w, h] = m; assert.ok(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= W && y + h <= H, `${name} mark @${t}`); } }
  }
});

test('scripts are pure functions of t and only produce finite numbers', () => {
  for (const [name, sc] of Object.entries(WP_SCENES)) {
    for (const t of [0, .5, 3.3, 7.9, 61.2, 3600.4]) assert.deepEqual(run(sc, t), run(sc, t), `${name} @${t}`);
    for (let t = 0; t < 40; t += .37) for (const [grp, o] of Object.entries(run(sc, t))) for (const [k, v] of Object.entries(o)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${name}.${grp}.${k} @${t}`);
  }
});

test('the first still frame shows the point of the card (t0)', () => {
  const at = (n, t = WP_SCENES[n].t0) => run(WP_SCENES[n], t);
  assert.equal(at('key-on').st.keyOn, true); assert.equal(at('key-on').st.engineOn, false);   // ON, engine still off
  assert.ok(at('start').st.ign.t >= 1, 'cranking');
  assert.equal(at('park').st.park, true);   // lit first, then released
  assert.ok(at('clutch').st.clutch > .9); assert.ok(at('gas').st.gas > .5); assert.ok(at('brake').st.brake > .9);
  assert.ok(at('shift-up').st.rpm > 2000); assert.equal(at('lights').dn.head, true); assert.equal(at('cab-light').dn.cab, true);
  assert.equal(at('heater').st.heater, true); assert.equal(at('heater').st.cooler, true); assert.ok(at('heater').st.heatEff > 0 && at('heater').st.coolEff > 0);
});

test('loops show both states of a switch', () => {
  const seen = (n, f) => new Set(Array.from({ length: 120 }, (_, i) => f(run(WP_SCENES[n], i * .1)))); 
  assert.equal(seen('park', g => g.st.park).size, 2); assert.equal(seen('lights', g => g.dn.head).size, 2); assert.equal(seen('cab-light', g => g.dn.cab).size, 2);
  assert.deepEqual([...seen('wipers', g => g.wip.mode)].sort(), [0, 1, 2]); assert.equal(seen('wipers', g => g.st.washing).size, 2);
  assert.ok(seen('radio', g => g.radio.idx).size >= 4); assert.ok(seen('gear', g => g.st.gear).size >= 6);
  assert.deepEqual([...seen('i-gear', g => g.st.gear)].sort((a, b) => a - b), [-1, 0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok([...seen('i-rpm', g => g.st.rpm)].some(r => r > 2800), 'the tach reaches the red zone');
  assert.ok(Math.max(...seen('i-speed', g => g.st.v * 3.6)) <= 100.1, 'never past the governor');
  assert.ok(Math.max(...seen('steer', g => Math.abs(g.st.steer))) > .1);
});
