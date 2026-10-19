import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SCENES, drawScene } from '../src/chain-scenes.js';

/* UNDER THE HOOD (index.html .oc-grid): five flip cards, each a still SVG (no JS / reduced motion) that src/chain-scenes.js swaps for a canvas scene. */
const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(`${root}index.html`, 'utf8'), wp = readFileSync(`${root}whitepaper.html`, 'utf8');
const cards = [...html.matchAll(/<article data-card="(\w+)" class="oc[^"]*">([\s\S]*?)<\/article>/g)].map(m => ({ k: m[1], body: m[2] }));

test('five cards, each with its still drawing, a scene, a receipt and working links', () => {
  assert.deepEqual(cards.map(c => c.k).sort(), Object.keys(SCENES).sort());
  for (const { k, body } of cards) {
    const img = body.match(/<img src="\/media\/chain\/(\w+)\.svg" width="240" height="124"[^>]* alt="([^"]+)"/);
    assert.ok(img && img[1] === k, `${k}: <img> of its own svg with a size and an alt`);
    assert.ok(existsSync(`${root}public/media/chain/${k}.svg`), `${k}.svg exists`);
    assert.match(body, /<div class="rcpt">[\s\S]*EXAMPLE/, `${k}: the receipt says it is an example`);
    for (const [, hash] of body.matchAll(/href="\/whitepaper\.html#([\w-]+)"/g)) assert.match(wp, new RegExp(`id="${hash}"`), `${k}: whitepaper #${hash}`);
    for (const [, hash] of body.matchAll(/href="#([\w-]+)"/g)) assert.match(html, new RegExp(`id="${hash}"`), `${k}: #${hash}`);
  }
});

test('no card is a button: screen readers read both faces, the keyboard reaches the back through its links', () => {
  for (const { k, body } of cards) assert.match(body, /<nav>(<a [^>]+>[^<]+<\/a>)+<\/nav>/, `${k}: links on the back`);
  assert.doesNotMatch(html, /<article data-card[^>]*(role=|tabindex=|aria-label=)/);
});

/** a 2D context that does nothing but follow translate / scale / save / restore and record where each text, box and circle lands */
function fakeContext() {
  const texts = [], geo = []; let m = [1, 0, 0, 1, 0, 0]; const stack = [];
  const ctx = {
    texts, geo, globalAlpha: 1,
    roundRect: (x, y, w) => geo.push(`r${(m[4] + m[0] * x).toFixed(1)},${(m[5] + m[3] * y).toFixed(1)},${(w * m[0]).toFixed(1)}`),
    arc: (x, y, r) => geo.push(`a${(m[4] + m[0] * x).toFixed(1)},${(m[5] + m[3] * y).toFixed(1)},${(r * m[0]).toFixed(1)}`),
    setTransform: (a, b, c, d, e, f) => { m = [a, b, c, d, e, f]; },
    save: () => stack.push([...m]), restore: () => { m = stack.pop() ?? m; },
    translate: (x, y) => { m = [m[0], m[1], m[2], m[3], m[4] + m[0] * x, m[5] + m[3] * y]; },
    scale: (x, y) => { m = [m[0] * x, m[1], m[2], m[3] * y, m[4], m[5]]; },
    fillText: (s, x, y) => texts.push([s, m[4] + m[0] * x, m[5] + m[3] * y, ctx.globalAlpha]),
    measureText: s => ({ width: s.length * 5 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  return new Proxy(ctx, { get: (o, k) => (k in o ? o[k] : () => {}) });
}

for (const k of Object.keys(SCENES)) {
  test(`scene ${k}: 90 s at 30 fps never throws, keeps its text inside 240×124 and is no loop`, () => {
    const ctx = fakeContext(), draw = SCENES[k](), frames = new Set();
    for (let f = 0; f < 90 * 30; f++) {
      const before = ctx.texts.length, gb = ctx.geo.length;
      drawScene(ctx, draw, 1000 + f / 30);
      const now = ctx.texts.slice(before);
      for (const [s, x, y] of now) assert.ok(x >= 0 && x <= 240 && y >= 0 && y <= 124, `${k}: "${s}" at ${x.toFixed(1)},${y.toFixed(1)}`);
      frames.add(now.map(([s, x, y]) => `${s}@${x.toFixed(1)},${y.toFixed(1)}`).join('|') + ctx.geo.slice(gb).join('|'));
    }
    /* a plain loop of the longest cycle (7 s × 1.15) shows at most ~242 different frames in 90 s; the re-rolled values and timings must give clearly more than that (the noise changes 14× a second, not every frame) */
    assert.ok(frames.size > 1.25 * 7 * 1.15 * 30, `${k}: ${frames.size} distinct frames`);
  });
}
