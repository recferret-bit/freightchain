import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const stubThreeUrl = new URL('../tools/stub-three.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: stubThreeUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const ctxStub = new Proxy(function () {}, {
  get: (t, p) => p === 'createLinearGradient' || p === 'createRadialGradient' ? () => ({ addColorStop() {} }) : p === 'measureText' ? () => ({ width: 10 }) : () => {},
  set: () => true,
});
globalThis.document ??= {
  getElementById: () => ({ getContext: () => ctxStub, style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }),
  createElement: () => ({ getContext: () => ctxStub, style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {} }),
  addEventListener() {},
  body: { style: {}, appendChild() {}, append() {}, classList: { add() {}, remove() {}, toggle() {} } },
  querySelectorAll: () => [],
};
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };

const { en } = await import('../js/minigames/i18n/en.js');
const { ru } = await import('../js/minigames/i18n/ru.js');
const { machine } = await import('../js/minigames/machine.js');
const { smsModel } = await import('../js/minigames/play.js');
const { homeLayout } = await import('../js/phone/home.js');
const { mgCapture } = await import('../js/minigames/capture.js');
const { os } = await import('../js/phone/os.js');
const { phone } = await import('../js/phone.js');
const { closesApp } = await import('../js/phone/swipe.js');

test('minigame copy has the same keys in English and Russian', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  assert.equal(en['sim.badge'], 'SIMULATION. Game coins — not real money or addresses');
  assert.equal(ru['sim.badge'], 'СИМУЛЯЦИЯ. Игровые монеты, ненастоящие деньги и адреса');
});

test('the client model of an SMS keeps permutations and drops the answer', () => {
  const model = smsModel({
    threads: [{ id: 'aa', role: 'dispatch', bubbles: [{ assetId: 'bbbbbbbbbbbbbbbb' }] }],
    keys: ['1'],
    sendSlot: 8,
    iconOrder: null,
    cab: [{ id: 'not-the-picture', assetId: 'cccccccccccccccc', slot: 2 }],
    trap: true,
    exact: '4821',
    answer: '4821',
  });
  assert.equal('trap' in model, false);
  assert.equal('exact' in model, false);
  assert.equal('answer' in model, false);
  assert.equal(model.keys.length, 10);
  assert.equal(model.sendSlot, 2);
  assert.equal(model.threads[0].previewAsset, 'bbbbbbbbbbbbbbbb');
  assert.equal(model.cab[0].id, 'cccccccccccccccc');
  assert.equal(model.cab[0].slot, 2);
});

test('minigame machine only takes the legal step', () => {
  machine.send('idle');
  assert.equal(machine.phase, 'idle');
  machine.event = { id: 'abc' };
  assert.equal(machine.send('arm'), true);
  assert.equal(machine.phase, 'armed');
  assert.equal(machine.send('reveal'), false);
  assert.equal(machine.phase, 'armed');
  assert.equal(machine.send('open'), true);
  assert.equal(machine.send('armed'), true);
  assert.equal(machine.phase, 'armed');
  assert.equal(machine.send('open'), true);
  assert.equal(machine.send('reveal'), true);
  assert.equal(machine.send('defer'), true);
  assert.equal(machine.phase, 'armed');
  assert.equal(machine.deferred, true);
  machine.send('idle');
});

test('home launcher is 4 columns of apps plus the dock, and empty slots stay empty', () => {
  phone.iconOrder = null;
  const lay = homeLayout(0, 0, 300, 600, false);
  const dock = lay.icons.filter(i => i.dock);
  const grid = lay.icons.filter(i => !i.dock);
  assert.deepEqual(dock.map(i => i.id), ['calls', 'web', 'music']);
  assert.equal(grid.length, 11);
  assert.ok(grid.some(i => i.id === 'gulp'));
  assert.ok(grid.some(i => i.id === 'pike'));
  assert.ok(grid.some(i => i.id === 'swap'));
  assert.ok(grid.some(i => i.id === 'chat'));
  assert.ok(grid.some(i => i.id === 'maps'));
});

test('a revealed minigame captures digits and leaves the driving keys alone', () => {
  phone.open = true;
  os.job = { phase: 'revealed', kind: 'phone-sms', ui: 'list', draft: '', touched: false };
  assert.equal(mgCapture.handles({ code: 'Digit3', type: 'keydown' }), true);
  assert.equal(mgCapture.handles({ code: 'KeyW', type: 'keydown' }), true);
  assert.equal(mgCapture.handles({ code: 'KeyP', type: 'keydown' }), false);
  assert.equal(mgCapture.handles({ code: 'Escape', type: 'keydown' }), false);
  assert.equal(mgCapture.handles({ code: 'KeyM', type: 'keydown' }), false);
  assert.equal(mgCapture.handles({ code: 'KeyB', type: 'keydown' }), false);
  os.job.ui = 'keys';
  assert.equal(mgCapture.handles({ code: 'KeyB', type: 'keydown' }), true);
  os.job.kind = 'seed-words';
  assert.equal(mgCapture.handles({ code: 'Space', type: 'keydown' }), true);
  os.job = null;
  phone.open = false;
  assert.equal(mgCapture.handles({ code: 'Digit3', type: 'keydown' }), false);
});

test('a swipe up from the bottom closes an app, and a map drag does not', () => {
  assert.equal(closesApp(520, 600, 4, -80), true);
  assert.equal(closesApp(500, 600, 90, -80), false);
  assert.equal(closesApp(200, 600, 0, -120), false);
  assert.equal(closesApp(560, 600, 0, -20), false);
  assert.equal(closesApp(560, 600, 0, 40), false);
});
