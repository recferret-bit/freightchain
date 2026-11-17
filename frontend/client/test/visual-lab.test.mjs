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

const mem = new Map();
globalThis.localStorage ??= {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
globalThis.document ??= {
  getElementById: () => ({ getContext: () => ({}), style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }),
  createElement: () => ({ getContext: () => ({}), style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }),
  body: { style: {}, classList: { add() {}, remove() {}, toggle() {} } },
  querySelectorAll: () => [],
};
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};

const {
  DEFAULT_PIXEL_PARAMS, getPixelArtParams, getPixelScope, isPixelArtOn,
  resetPixelArtParams, setPixelArt, setPixelArtParams, setPixelScope, togglePixelArt,
} = await import('../js/world/pixel-pass.js');
const {
  DEFAULT_CRT_PARAMS, getCrtParams, isCrtOn, resetCrtParams, setCrt, setCrtParams, toggleCrt,
} = await import('../js/ui/crt.js');

test('pixel-pass persists enable flag, scope (world vs all), and shader params', () => {
  assert.equal(isPixelArtOn(), true);
  assert.equal(getPixelScope(), 'world');
  assert.deepEqual(getPixelArtParams(), DEFAULT_PIXEL_PARAMS);

  assert.equal(setPixelScope('all'), 'all');
  assert.equal(mem.get('freightchain.pixel.scope'), 'all');
  assert.equal(setPixelScope('invalid'), 'world');

  assert.equal(togglePixelArt(), false);
  assert.equal(mem.get('freightchain.pixel'), '0');
  assert.equal(setPixelArt(true), true);
  assert.equal(mem.get('freightchain.pixel'), '1');

  setPixelArtParams({ pixelSize: 6, paletteMode: 2 });
  assert.equal(getPixelArtParams().pixelSize, 6);
  assert.equal(getPixelArtParams().paletteMode, 2);
  assert.equal(JSON.parse(mem.get('freightchain.pixel.params')).pixelSize, 6);

  resetPixelArtParams();
  assert.equal(getPixelScope(), 'world');
  assert.deepEqual(getPixelArtParams(), DEFAULT_PIXEL_PARAMS);
});

test('crt overlay persists enable flag and shader params without touching Math.random', () => {
  const rand0 = Math.random;
  let randomCalls = 0;
  Math.random = () => { randomCalls++; return 0.5; };
  try {
    assert.equal(isCrtOn(), true);
    assert.deepEqual(getCrtParams(), DEFAULT_CRT_PARAMS);
    assert.equal(toggleCrt(), false);
    assert.equal(mem.get('freightchain.crt'), '0');
    assert.equal(setCrt(true), true);

    setCrtParams({ scanlineIntensity: 0.42, waveAmplitude: 24 });
    assert.equal(getCrtParams().scanlineIntensity, 0.42);
    assert.equal(getCrtParams().waveAmplitude, 24);
    assert.equal(JSON.parse(mem.get('freightchain.crt.params')).scanlineIntensity, 0.42);

    resetCrtParams();
    assert.deepEqual(getCrtParams(), DEFAULT_CRT_PARAMS);
    assert.equal(randomCalls, 0);
  } finally {
    Math.random = rand0;
  }
});
