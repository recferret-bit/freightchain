import test from 'node:test';
import assert from 'node:assert/strict';

/* Run the real coin loop with a controlled clock; only the DOM/canvas are replaced. */
async function pile(t) {
  let frames = [], draws = [], transform, id = 0, now = 0;
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
    setTransform: (...m) => { transform = m; }, drawImage: () => draws.push({ x: transform[4], y: transform[5] }),
  }, { get: (o, k) => o[k] ?? (() => {}) });
  const el = () => ({ style: {}, addEventListener() {}, remove() {} });
  const stage = { ...el(), append() {}, animate() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) }, deck = { children: [] };
  const globals = { document: { getElementById: k => k === 'stage' ? stage : deck, createElement: tag => tag === 'canvas' ? { getContext: () => ctx } : el() }, matchMedia: () => ({ matches: false }), requestAnimationFrame: f => { frames.push(f); return ++id; } };
  for (const [k, v] of Object.entries(globals)) {
    const old = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    t.after(() => { if (old) Object.defineProperty(globalThis, k, old); else delete globalThis[k]; });
  }
  t.mock.method(Math, 'random', () => .5);
  const m = await import(`../src/pitchdeck/coins.js?case=${t.name}`);
  return { ...m, step(n = 1) { for (let i = 0; i < n; i++) { draws = []; now += 1000 / 60; const batch = frames; frames = []; for (const f of batch) f(now); } return draws; } };
}

test('DONATIONS starts the coin loop, falls under default gravity and stays above the floor', async t => {
  const p = await pile(t); p.donate(); const first = p.step();
  assert.ok(first.length >= 5); assert.ok(first.every(c => c.y < 0));
  const falling = p.step(30); assert.ok(falling.every((c, i) => c.y > first[i].y + 300));
  const landed = p.step(180); assert.ok(landed.every(c => c.y > 900 && c.y < 1080));
  assert.deepEqual(p.step(600), [], 'a settled pile stops requesting frames');
  p.donate(); assert.ok(p.step().some(c => c.y < 0), 'another donation restarts falling after the pile sleeps');
});

for (const [label, x, y] of [['flat', 0, 0], ['right', 1, 0], ['left', -1, 0], ['upside down', 0, -1]]) {
  test(`DONATIONS is visible with ${label} phone gravity and moves toward the low edge`, async t => {
    const p = await pile(t); for (let i = 0; i < 150; i++) p.setCoinGravity(x, y);
    p.donate(); const first = p.step(); assert.ok(first.length >= 5);
    assert.ok(first.every(c => c.x > 0 && c.x < 1920 && c.y > 40 && c.y < 1080), 'coins enter the visible stage even without downward gravity');
    const moved = p.step(15);
    for (let i = 0; i < first.length; i++) {
      if (!x && !y) assert.ok(Math.hypot(moved[i].x - first[i].x, moved[i].y - first[i].y) < 1, 'a flat phone has no in-plane acceleration');
      else assert.ok((moved[i].x - first[i].x) * x + (moved[i].y - first[i].y) * y > 60, 'gravity pulls along the screen');
    }
    const settled = p.step(240); assert.ok(settled.every(c => c.x > 0 && c.x < 1920 && c.y > 40 && c.y < 1080), 'stage walls contain the pile');
  });
}

test('invalid sensor readings cannot poison gravity or stop later donations', async t => {
  const p = await pile(t); for (const [x, y] of [[NaN, 0], [0, Infinity], [undefined, 1]]) p.setCoinGravity(x, y);
  p.donate(); const first = p.step(), next = p.step(30);
  assert.ok(next.every((c, i) => Number.isFinite(c.x) && Number.isFinite(c.y) && c.y > first[i].y + 300));
});
