import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileExpr, parseExpr, ExprError } from '../shared/entity/expr.js';
import { Scope } from '../shared/entity/expr.js';
import { parseSource, printSource, SourceError } from '../shared/entity/source.js';
import { compileEntity, toParts, PlanError } from '../shared/entity/plan.js';
import { validateEntity } from '../shared/entity/schema.js';
import { ROSTER } from '../shared/entity/roster.js';
import SEED from '../shared/entity/seed/index.js';
import { VEHICLES } from '../shared/traffic.js';

const here = dirname(fileURLToPath(import.meta.url)), seedDir = join(here, '..', 'shared', 'entity', 'seed');
const byId = new Map(SEED.map(e => [e.id, e])), lookup = id => byId.get(id);
const ev = (src, vars = {}) => { const s = new Scope(), names = Object.keys(vars); names.forEach(n => s.declare(n)); return compileExpr(src, s)(names.map(n => vars[n])); };

test('expressions evaluate exactly like JS (precedence, unary minus, float order)', () => {
  for (const [src, vars] of [['-len / 2 + 1.4', { len: 7.5 }], ['11.6 - k * .35 - 0.4', { k: 3 }], ['h * 0.45 + h * 0.17', { h: 3.3 }], ['x * (xo - tw / 2 + 0.035)', { x: -1, xo: 1.005, tw: .24 }],
    ['hi ? 12 : 8', { hi: true }], ['r2 > 0.3 && r2 <= 0.65', { r2: .5 }], ['-sd * arm / 2', { sd: 1, arm: 3.6 }], ['sign(s) * R + s * half', { s: Math.sin(-.6), R: .13, half: .77 }], ['Math.min(2.4, len * .3)', { len: 9 }]]) {
    const js = new Function(...Object.keys(vars), 'const {min,max,sign}=Math; return ' + src)(...Object.values(vars));
    assert.ok(Object.is(ev(src, vars), js), `${src} = ${js}`);
  }
  assert.equal(ev('palette[pick % len(palette)]', { palette: [1, 2, 3], pick: 4 }), 2);
  assert.equal(ev('0xb8bcc2 == c ? 1 : 0', { c: 0xb8bcc2 }), 1);
  assert.ok(Number.isNaN(ev('l[5]', { l: [1] })));
});

test('expressions refuse code: unknown names and functions, member access, eval tricks, oversize', () => {
  for (const bad of ['constructor', 'x.constructor', 'alert(1)', 'Math.random()', 'globalThis', 'a = 1', '`x`', '"s"', 'f()()', '1 < 2 < 3', '(' .repeat(30) + '1' + ')'.repeat(30), 'x'.repeat(300)])
    assert.throws(() => compileExpr(bad, new Scope()), ExprError, bad);
  assert.throws(() => parseExpr('min(1)'), /2–4 argument/);
  for (const proto of ['toString(1)', 'hasOwnProperty(1, 2)', 'valueOf', 'isPrototypeOf', '__defineGetter__(1, 2)'])   // Object.prototype names are not functions or constants
    assert.throws(() => compileExpr(proto, new Scope()), ExprError, proto);
});

test('source: literal-only parser, never runs code; printer round-trips every seed file', () => {
  for (const bad of ['export default foo;', 'export default { a: f() };', 'export default { ...x };', 'export default { [k]: 1 };', 'export default { __proto__: {} };', 'export default `x`;', 'export default { a: 1 }; alert(1)', 'module.exports = {}', "export default { a: 'x\ry' };"])
    assert.throws(() => parseSource(bad), SourceError, bad);
  assert.deepEqual(parseSource("// c\nexport default { a: -0x10, 'b': [1, .5, -2e3,], c: \"q\\n\\r\\t\", d: true, e: null, /* x */ };"), { a: -16, b: [1, .5, -2000], c: 'q\n\r\t', d: true, e: null });
  const ctrl = { s: 'a\rb\tc\x00\x1f' }, ctrlSrc = printSource(ctrl);
  assert.deepEqual(parseSource(ctrlSrc), ctrl);
  for (const kind of readdirSync(seedDir).filter(d => !d.endsWith('.js'))) for (const f of readdirSync(join(seedDir, kind))) {
    const text = readFileSync(join(seedDir, kind, f), 'utf8'), v = parseSource(text);
    assert.deepEqual(v, byId.get(f.replace(/\.js$/, '')), `${kind}/${f} parses to what it exports`);
    const p = printSource(v); assert.equal(printSource(parseSource(p)), p, `${f} prints stably`); assert.deepEqual(parseSource(p), v);
  }
});

test('every seed entity validates; the roster matches KINDS, the seed and VEHICLES', async () => {
  for (const e of SEED) { const r = validateEntity(e, { lookup }); assert.ok(r.ok, `${e.id}: ${r.errors.join('; ')}`); }
  const { KINDS } = await import('../js/world/props.js').catch(() => ({ KINDS: null }));
  for (const [id, l] of Object.entries({ ...ROSTER.prop, ...ROSTER.furniture })) { assert.ok(byId.has(id), id); if (KINDS) assert.ok(l.kind in KINDS, `${id}: ${l.kind}`); }
  for (const impls of Object.values(ROSTER.landmark)) for (const v of impls) assert.equal(byId.get(v.id)?.kind, 'landmark', v.id);
  assert.deepEqual(Object.keys(ROSTER.vehicle).sort(), Object.keys(VEHICLES).sort());
});

test('validation refuses gameplay keys, broken parts and out-of-contract edits', () => {
  const sedan = structuredClone(byId.get('sedan'));
  const bad = (e, re) => { const r = validateEntity(e, { lookup }); assert.ok(!r.ok && r.errors.some(x => re.test(x)), `${re}: ${r.errors.join('; ')}`); };
  bad({ ...sedan, hp: 9 }, /gameplay/);
  bad({ ...sedan, parts: [{ geo: 'box', s: [1, 1, 1], mat: { color: 1 }, dmg: 3 }] }, /gameplay/);
  bad({ ...sedan, parts: [{ use: 'veh-car-body', with: { len: 'len', w: 'w', color: 'body', hi: 'hi' } }, { use: 'veh-siren', with: { w: 'w' } }] }, /siren/);
  bad({ ...sedan, parts: [{ use: 'veh-box-body', with: { len: 'len * 2', w: 'w', h: 'h' } }] }, /leaves the/);
  bad({ ...sedan, parts: [{ geo: 'box', s: ['nope', 1, 1], mat: { color: 1 } }] }, /unknown name/);
  bad({ ...sedan, parts: [{ for: 'i', range: [0, 1000], do: [{ geo: 'box', s: [1, 1, 1], mat: { color: 1 } }] }] }, /iterations/);
  bad({ ...sedan, parts: [{ for: ['i', 'j'], range: [0, 2], do: [{ geo: 'box', s: [1, 1, 1], mat: { color: 1 } }] }] }, /single variable name/);
  bad({ id: 'bad-enum', kind: 'part', v: 1, params: { p: { default: 1, enum: 'not-an-array' } }, parts: [{ geo: 'box', s: [1, 1, 1], mat: { color: 1 } }] }, /1–32 numbers/);
  bad({ id: 'bad-min', kind: 'part', v: 1, params: { p: { default: 1, min: 'low', max: 5 } }, parts: [{ geo: 'box', s: [1, 1, 1], mat: { color: 1 } }] }, /finite number/);
  bad({ ...structuredClone(byId.get('birch')), parts: [{ geo: 'cyl', tag: 'trunk', mat: 'trunk', s: [.1, 'h', .1] }, { geo: 'cyl', tag: 'trunk', mat: 'trunk', s: [.1, 'h', .1] }] }, /exactly one part tagged 'trunk'/);
  const cactus = structuredClone(byId.get('cactus'));
  bad({ ...cactus, params: { h: cactus.params.h }, parts: [cactus.parts[0]] }, /keep that param/);
  bad({ ...structuredClone(byId.get('cactus')), kind: 'part' }, /kind cannot change/);
  const rock = structuredClone(byId.get('rock'));   // prototype names: a validator that says ok must mean the game can build it
  bad({ ...rock, parts: [...rock.parts, { use: 'constructor' }] }, /unknown entity 'constructor'/);
  bad({ ...rock, parts: [{ ...rock.parts[0], ifSlot: 'constructor' }] }, /ifSlot/);
  bad({ ...rock, parts: [{ ...rock.parts[0], rot: [0, 'r2 > 0.2 && r2 < 0.3 ? toString(1) : r2', 0] }] }, /unknown function 'toString'/);
  bad({ id: 'proto-part', kind: 'part', v: 1, parts: [{ geo: 'box', mat: 'constructor', s: [1, 1, 1] }] }, /not a slot/);
  bad({ ...rock, parts: [{ ...rock.parts[0], note: 'x'.repeat(201) }] }, /at most 200/);
  const loop = { id: 'loop-a', kind: 'part', v: 1, parts: [{ use: 'loop-a' }] };
  assert.throws(() => compileEntity(loop, { lookup: () => loop }), PlanError);
  const ordered = { id: 'ord', kind: 'part', v: 1, vars: { zc: 'cabL / 2', cabL: 4 }, parts: [{ geo: 'box', mat: { color: 1 }, s: [1, 1, 'zc'], at: [0, 0.5, 0] }] };
  assert.equal(toParts(compileEntity(ordered), {})[0].s[2], 2, 'a var may name one declared later in the object');
  assert.throws(() => compileEntity({ id: 'cyc', kind: 'part', v: 1, vars: { a: 'b', b: 'a' }, parts: [] }), /unknown name|cycle/);
});

test('a huge but finite model is refused, and two params are checked together', () => {
  const bad = (e, re) => { const r = validateEntity(e, { lookup }); assert.ok(!r.ok && r.errors.some(x => re.test(x)), `${re}: ${r.errors.join('; ')}`); };
  bad({ id: 'huge-box', kind: 'part', v: 1, slots: { m: {} }, parts: [{ geo: 'box', mat: 'm', s: [1e16, 1, 1], at: [0, 0.5, 0] }] }, /bigger than 80 m/);
  bad({ id: 'blow-box', kind: 'part', v: 1, params: { s: { default: 1, min: 1, max: 6 }, h: { default: 1, min: 1, max: 6 } }, slots: { m: {} }, parts: [{ geo: 'box', mat: 'm', s: ['1 / (s + h - 12)', 1, 1], at: [0, 0.5, 0] }] }, /not a finite number/);
});

test('a published config the validator refuses falls back to the seed without breaking dependents', async () => {
  const { guardBundle } = await import('../shared/entity/bundle.js');
  const huge = { id: 'rock', kind: 'prop', v: 1, parts: [{ geo: 'box', mat: { color: 1 }, s: [1e16, 1, 1] }] };
  const brokenWheels = { id: 'veh-wheels', kind: 'part', v: 1, parts: [] };
  const customSedan = { ...structuredClone(byId.get('sedan')), note: 'custom sedan' };
  const kept = guardBundle([customSedan, brokenWheels, huge, { id: 'not-a-seed', kind: 'part', v: 1, parts: [] }], SEED);
  const keptBy = new Map(kept.map(e => [e.id, e]));
  assert.equal(keptBy.get('rock'), byId.get('rock'));
  assert.equal(keptBy.get('veh-wheels'), byId.get('veh-wheels'));
  assert.equal(keptBy.get('sedan').note, 'custom sedan');
  assert.equal(keptBy.has('not-a-seed'), false);
});

test('a plan is the same part list on every run (no hidden state, no randomness)', () => {
  for (const e of SEED.filter(x => x.kind !== 'part')) {
    const prog = compileEntity(e, { lookup, cache: new Map() }), args = e.kind === 'vehicle' ? { len: VEHICLES[e.id].len, w: VEHICLES[e.id].w, h: VEHICLES[e.id].h } : {};
    assert.deepEqual(toParts(prog, args), toParts(prog, args), e.id);
  }
});

test('malformed and hostile model data is refused without throwing or entering unbounded painters', () => {
  const box = { id: 'review-box', kind: 'part', v: 1, parts: [{ geo: 'box', mat: { color: 1 }, s: [1, 1, 1] }] };
  for (const parts of [null, {}, 1, 'parts', [null], [{ for: 'x', in: [1], let: 1, do: [] }]]) {
    assert.doesNotThrow(() => validateEntity({ ...box, parts }));
    // A primitive let object has no declarations, so other malformed forms are asserted separately below.
    if (!Array.isArray(parts) || parts[0] === null) assert.equal(validateEntity({ ...box, parts }).ok, false);
  }
  assert.throws(() => parseSource('export default { x: 1e999 };'), SourceError);
  const facade = { ...box, kind: 'landmark', parts: [{ ...box.parts[0], mat: { facade: [1e10, 1e10] } }] };
  assert.equal(validateEntity(facade).ok, false);
  for (const mat of [[[{ color: 1 }]], [{ if: true, then: [{ color: 1 }], else: { color: 1 } }]]) assert.equal(validateEntity({ ...box, parts: [{ ...box.parts[0], mat }] }).ok, false);
  assert.equal(validateEntity({ ...facade, parts: [{ ...box.parts[0], mat: { facade: [2, '1 / 0'] } }] }).ok, false);
  const child = { ...box, id: 'review-child', parts: [{ sign: { w: 1, h: 1, style: 'red', text: 'x' } }] };
  assert.equal(validateEntity({ ...box, kind: 'prop', parts: [{ use: child.id }] }, { lookup: () => child }).ok, false);
  const missing = { ...box, id: 'review-missing', parts: [{ ...box.parts[0], mat: 'missing' }] };
  assert.equal(validateEntity({ ...box, kind: 'prop', parts: [{ use: missing.id }] }, { lookup: () => missing }).ok, false);
  assert.equal(validateEntity({ ...box, parts: [{ glow: { color: 1, size: 1e12, gain: 1 } }] }).ok, false);
  const tagged = validateEntity({ ...box, parts: [{ ...box.parts[0], tag: '__proto__' }] });
  assert.equal(tagged.measures.tags.__proto__, 1);
  const params = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`p${i}`, { default: 1, enum: Array(32).fill(1) }]));
  assert.match(validateEntity({ ...box, params }).errors.join(' '), /more than 96 corners/);
});
