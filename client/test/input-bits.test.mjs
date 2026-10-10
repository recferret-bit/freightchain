import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTROLS, BIT, MOUSE, DASH, CAP, CLUSTER, INPUT_COL, FADE, SCAN, inputBits, maskOf, readMask, passedMask, lightInputs, clearInputs } from '../js/input-bits.js';
import { st } from '../js/state.js';
import { CFG } from '../js/config.js';
import { telemetry, FLAGS, startTelemetry, recordInput, releaseInputs, tickTelemetry } from '../js/telemetry.js';

const src = f => readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
const L0 = () => ({ on: true, mask: 0, key: new Float32Array(CONTROLS.length), mouse: new Float32Array(CONTROLS.length) });
const at = c => CONTROLS.indexOf(c);

test('one bit per control, MOUSE apart, all within 30 bits (JS bitwise is 32-bit signed)', () => {
  const bits = [...Object.values(BIT), MOUSE];
  assert.equal(new Set(bits).size, bits.length);
  for (const b of bits) assert.ok(b > 0 && b < 2 ** 30 && Number.isInteger(Math.log2(b)), String(b));
  assert.equal(INPUT_COL, 14);
});
test('the bits are frozen – old recordings keep their meaning (append controls, never renumber)', () => {
  assert.deepEqual(CONTROLS.slice(0, 25), ['gas', 'brake', 'left', 'right', 'clutch', 'up', 'down', 'gear', 'reverse', 'start', 'stop', 'keyOn', 'park', 'heat', 'wiper', 'wash',
    'head', 'cab', 'night', 'radio', 'prev', 'next', 'volume', 'pause', 'mute']);
  assert.equal(MOUSE, 1 << 25);
  assert.deepEqual(CONTROLS.slice(25), ['map', 'cold']);   // appended after 'mute': they skip MOUSE's bit
  assert.equal(BIT.map, 1 << 26); assert.equal(inputBits('KeyN'), BIT.map); assert.equal(inputBits('btn:map'), BIT.map | MOUSE);
  assert.equal(BIT.cold, 1 << 27); assert.equal(inputBits('KeyJ'), BIT.cold); assert.equal(inputBits('btn:cold'), BIT.cold | MOUSE);
});
test('every key ui/input.js acts on maps to a control', () => {
  const input = src('ui/input.js');
  const codes = new Set([...input.matchAll(/\b((?:Key|Arrow|Shift)[A-Z][A-Za-z]*|Space|Comma|Period|Minus|Equal)\b/g)].map(m => m[1]));
  for (let g = 0; g <= 7; g++) codes.add(`Digit${g}`);
  assert.ok(codes.size >= 30, `found only ${codes.size} key codes`);
  for (const c of codes) assert.ok(inputBits(c) > 0, `${c} has no control`);
  assert.equal(inputBits('KeyW'), inputBits('ArrowUp')); assert.equal(inputBits('Space'), BIT.clutch); assert.equal(inputBits('Digit0'), BIT.gear);
  assert.equal(inputBits('Enter'), 0); assert.equal(inputBits('F2'), 0); assert.equal(inputBits(undefined), 0);
});
test('every dash button the cockpit draws is a control the replay can outline, a click adds MOUSE', () => {
  const ids = new Set([...['cockpit/rig.js', 'cockpit/common.js'].flatMap(f => [...src(f).matchAll(/(?:uiButton\(|id: )'([a-z-]+)'/g)].map(m => m[1])), 'key-off', 'key-on', 'key-start']);
  assert.equal(ids.size, 14, [...ids].join(' '));   // + the phone map (2026-10), + COLD beside HEAT
  for (const id of ids) {
    const b = inputBits(`btn:${id}`);
    assert.ok(b & MOUSE, `btn:${id}`);
    const c = CONTROLS.find(k => b & BIT[k]); assert.ok(DASH[c].includes(id), `${id} → ${c}`);
  }
  assert.equal(inputBits('btn:nope'), 0);
  assert.equal(inputBits('KeyL') | MOUSE, inputBits('btn:head'));   // the key and the click light the same button
});
test('a key cap for every keyboard control, and the cluster is the driving keys', () => {
  for (const c of CONTROLS) if (c !== 'keyOn') assert.ok(CAP[c], c);
  assert.deepEqual(CLUSTER.map(c => CAP[c]).join(''), 'QWEASD⇧');
});
test('masks: held codes OR together; a column value is read only when it is a sane mask', () => {
  assert.equal(maskOf(['KeyW', 'ArrowUp', 'KeyA']), BIT.gas | BIT.left);
  assert.equal(maskOf([]), 0);
  for (const v of [undefined, null, -1, 1.5, 'x', NaN, 2 ** 31]) assert.equal(readMask(v), 0, String(v));
  assert.equal(readMask(BIT.gas | MOUSE), BIT.gas | MOUSE);
});

const rows = masks => masks.map((m, k) => [k / 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 0, m]);
test('a replay frame lights every sample the playhead passed – a tap between two frames is not lost at 16×', () => {
  const R = rows([0, 0, BIT.head | MOUSE, 0, 0, 0, 0, 0, BIT.gas, 0]);
  assert.equal(passedMask(R, 9, R[1][0]), BIT.head | MOUSE | BIT.gas);   // jumped 8 samples in one frame
  assert.equal(passedMask(R, 9, R[8][0]), 0);   // one sample on: only the newest one
  assert.equal(passedMask(R, 8, R[8][0]), BIT.gas);   // paused: the sample at the playhead stays lit
  assert.equal(passedMask(R, 2, R[2][0]), BIT.head | MOUSE);   // paused on the click: it is shown for as long as the pause lasts
  assert.equal(passedMask(R, 8, -1), BIT.gas);   // after a jump / seek: only the sample at the playhead
  assert.equal(passedMask(R, 2, R[8][0]), BIT.head | MOUSE);   // going back: only the playhead
  const long = rows(Array.from({ length: SCAN + 10 }, (_, k) => (k === 1 ? BIT.night : 0)));
  assert.equal(passedMask(long, SCAN + 9, 0), 0);   // further back than SCAN rows = a jump, not a scan of the whole recording
  assert.equal(passedMask(rows([BIT.gas, 0]).map(r => r.slice(0, 14)), 1, 0), 0);   // a recording from before the column: nothing
});
test('lights: held = 1 (the cockpit flashes it), released = fades out over FADE wall seconds, a click lights the dash button as MOUSE', () => {
  const L = L0();
  lightInputs(BIT.gas | BIT.head, .016, L);
  assert.equal(L.key[at('gas')], 1); assert.equal(L.key[at('head')], 1); assert.equal(L.mouse[at('head')], 0);
  lightInputs(0, FADE / 2, L);
  assert.ok(Math.abs(L.key[at('gas')] - .5) < 1e-6);
  lightInputs(0, FADE, L);
  assert.equal(L.key[at('gas')], 0);
  lightInputs(BIT.wiper | BIT.gas | MOUSE, .016, L);   // holding W and clicking WIPER: the click is the dash button, W stays a key
  assert.equal(L.mouse[at('wiper')], 1); assert.equal(L.key[at('wiper')], 0); assert.equal(L.key[at('gas')], 1); assert.equal(L.mouse[at('gas')], 0);
  clearInputs(L); assert.equal(L.key.reduce((a, b) => a + b), 0); assert.equal(L.mask, 0);
  lightInputs(BIT.map, .016, L); assert.equal(L.key[at('map')], 1); assert.equal(L.mouse[at('map')], 0);   // the control past MOUSE lights by its own bit (N on the keyboard)…
  clearInputs(L); lightInputs(BIT.wiper | MOUSE, .016, L); assert.equal(L.key[at('map')] + L.mouse[at('map')], 0);   // …and a dash click does not light it
});

test('the recording: column 14 = held now OR pressed since the last sample; releases while paused and a lost focus clear it', () => {
  st.mode = 'drive'; st.t = 0; CFG.TELEMETRY_HZ = 10;
  startTelemetry('ride-x');
  const tick = () => { tickTelemetry(.1); return telemetry.samples.at(-1); };
  recordInput('KeyW', 1); assert.equal(tick()[INPUT_COL], BIT.gas);
  assert.equal(tick()[INPUT_COL], BIT.gas);   // still held
  recordInput('btn:head', 1); recordInput('btn:head', 0);   // a click shorter than a sample
  assert.equal(tick()[INPUT_COL], BIT.gas | BIT.head | MOUSE);
  assert.equal(tick()[INPUT_COL], BIT.gas);   // the click was in ONE sample
  recordInput('ArrowUp', 1); recordInput('KeyW', 0); assert.equal(tick()[INPUT_COL], BIT.gas);   // ↑ still holds GAS
  st.mode = 'pause'; recordInput('ArrowUp', 0); st.mode = 'drive';   // let go in the pause menu: not an input event, but no longer held
  assert.equal(tick()[INPUT_COL], 0);
  recordInput('Space', 1); releaseInputs(); assert.equal(tick()[INPUT_COL], BIT.clutch);   // focus lost: the tap still shows once…
  assert.equal(tick()[INPUT_COL], 0);   // …and nothing sticks
  assert.equal(telemetry.samples.every(r => r.length === 16 && r[15] === 0), true);   // column 15: the fork road (0 off a fork)
  recordInput('KeyJ', 1); recordInput('KeyJ', 0); assert.equal(tick()[INPUT_COL], BIT.cold);   // a tap of J, same as any other dash key
  recordInput('btn:cold', 1); recordInput('btn:cold', 0); assert.equal(tick()[INPUT_COL], BIT.cold | MOUSE);   // a click of COLD
  const extra = telemetry.extra;
  st.cooler = true; st.heater = false; st.keyOn = true; st.engineOn = true;
  telemetry.extra = () => [12, (st.engineOn ? FLAGS.engine : 0) | (st.keyOn ? FLAGS.key : 0) | (st.heater ? FLAGS.heater : 0) | (st.cooler ? FLAGS.cooler : 0)];
  const cold = tick();
  assert.equal(cold[13] & FLAGS.cooler, FLAGS.cooler); assert.equal(cold[13] & FLAGS.heater, 0);   // column 13: the switches mask, cooling appended at 2048
  st.heater = true; st.cooler = false;
  const heat = tick();
  assert.equal(heat[13] & FLAGS.heater, FLAGS.heater); assert.equal(heat[13] & FLAGS.cooler, 0);
  telemetry.extra = extra; st.cooler = false; st.heater = false;
  assert.deepEqual(telemetry.inputs.map(e => [e[1], e[2]]), [['KeyW', 1], ['btn:head', 1], ['btn:head', 0], ['ArrowUp', 1], ['KeyW', 0], ['Space', 1], ['KeyJ', 1], ['KeyJ', 0], ['btn:cold', 1], ['btn:cold', 0]]);   // the raw events are unchanged (the verdict reads them)
  telemetry.on = false;
});
test('cooling is recorded and replayed on the same path as the heater', () => {
  assert.equal(FLAGS.cooler, 2048); assert.equal(FLAGS.heater, 32);
  assert.match(src('ui/game.js'), /st\.heater \? FLAGS\.heater : 0/);
  assert.match(src('ui/game.js'), /st\.cooler \? FLAGS\.cooler : 0/);
  assert.match(src('watch.js'), /st\.heater = !!\(f & FLAGS\.heater\); st\.cooler = !!\(f & FLAGS\.cooler\)/);
  assert.match(src('watch.js'), /st\.coolEff = st\.cooler && st\.engineOn \? 1 : 0/);
  assert.match(src('ui/input.js'), /e\.code === 'KeyJ'\) \{ if \(st\.mode === 'drive'\) toggleCooler\(\)/);
  assert.match(src('ui/input.js'), /b\.id === 'cold'\) toggleCooler\(\)/);
});
