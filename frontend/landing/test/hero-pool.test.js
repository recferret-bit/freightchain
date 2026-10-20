import test from 'node:test';
import assert from 'node:assert/strict';

const NOTE = 'Free rides and practice are open. No prize has been paid.';
const IDS = ['hero-pot-lbl', 'hero-pot', 'hero-usd', 'hero-pot-note', 'hero-cd', 'lb-entries', 'lb-pot', 'lb-tickets-st', 'lb-pools-st', 'poolbox'];

async function load(t) {
  const node = (text = '') => ({ textContent: text, hidden: false, className: '', dataset: {}, style: {}, children: [], setAttribute() {}, addEventListener() {}, append(c) { this.children.push(c); }, replaceChildren(...kids) { this.children = kids; this.textContent = kids.map((k) => k.textContent ?? '').join(''); } });
  const nodes = Object.fromEntries(IDS.map((id) => [id, node(id === 'hero-pot' || id === 'hero-cd' ? '–' : '')]));
  const g = globalThis;
  const prev = { document: g.document, performance: g.performance, requestAnimationFrame: g.requestAnimationFrame, Node: g.Node };
  g.Node = g.Node ?? class Node {};
  g.document = { getElementById: (id) => nodes[id] ?? null, createElement: () => node(), createTextNode: (s) => ({ textContent: String(s) }) };
  g.performance = { now: () => 0 };
  g.requestAnimationFrame = () => 0;
  t.after(() => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete g[k]; else g[k] = v; } });
  const boards = await import(`../src/boards.js?hero=${t.name}`);
  return { nodes, ...boards };
}

const round = { endsAt: 1_000 };
const split = { grand: 0, top20: 0, nextSeed: 0, fees: 0 };

test('a null pool and a null current pool leave the static hero and do not throw', async (t) => {
  const { nodes, paintHero, paintPool } = await load(t);
  nodes['hero-pot-note'].textContent = 'Free rides & practice mode active · Devnet prize pool opening soon';
  for (const pool of [null, { pool: null }, undefined]) {
    assert.doesNotThrow(() => paintHero({ pool }, () => 0, true));
    assert.equal(nodes['hero-pot'].textContent, '–');
    assert.equal(nodes['hero-pot-note'].textContent, 'Free rides & practice mode active · Devnet prize pool opening soon');
    assert.doesNotThrow(() => paintPool({ pool }, () => 0));
  }
});

test('an empty pool with no split shows the fallback copy instead of reading split.grand', async (t) => {
  const { nodes, paintHero } = await load(t);
  for (const pool of [{ pools: [] }, { pools: null }, {}, { pools: [], split: null, usd: null }]) {
    assert.doesNotThrow(() => paintHero({ pool }, () => 0, true));
    assert.equal(nodes['hero-pot'].textContent, '–');
    assert.equal(nodes['hero-usd'].textContent, '');
    assert.equal(nodes['hero-pot-note'].textContent, NOTE);
    assert.equal(nodes['hero-pot-note'].hidden, false);
    assert.equal(nodes['hero-cd'].textContent, '–');
  }
});

test('an accrued empty pool still prints the unpaid note when split and usd are present', async (t) => {
  const { nodes, paintHero } = await load(t);
  paintHero({ pool: { pools: [], split, usd: { grand: null }, round } }, () => 0, true);
  assert.equal(nodes['hero-pot-lbl'].textContent, 'ACCRUED THIS WEEK · NOT PAID');
  assert.equal(nodes['hero-pot'].textContent, '–');
  assert.equal(nodes['hero-usd'].textContent, '');
  assert.equal(nodes['hero-pot-note'].textContent, NOTE);
});
