import { Scope, compileExpr } from './expr.js';

/* Compiles an entity config into a program that drives a SINK – the game's three.js builder (client/js/world/entity-build.js)
   or the part list the Node tools measure (toParts below). Expressions are compiled once; a run is closures over one frame array.

   Sink interface (all numbers already evaluated):
     hasSlot(name)                                  – a theme slot was supplied (ifSlot)
     mesh(geo, mat, sx, sy, sz, x, y, z, rot, order, tag)   mat = descriptor or [descriptors] (three.js face-group order)
     glow(color, size, gain, x, y, z, role)         beam(color, gain, w, l, z0, back)        banner(w, h, x, y, z)
     push({ role, visible, at, rot, order, ref })   pop()        ref = { id, kind, label, params, debris } of a referenced entity
   Material descriptors: { slot } { color, lamp } { global } { facade: [cols, rows] } { sign, text } { edge } { disk, text, back } { flag, side }. */

export const GEOS = ['box', 'cyl', 'cone', 'rock', 'pyr', 'wheel20', 'wheel48', 'barrel'];
export const ROLES = ['brake', 'ind.l', 'ind.r', 'flash.0', 'flash.1', 'glow'];
export const SIGN_STYLES = ['neon', 'red', 'blue', 'cream'];
export const GLOBAL_MATS = ['red', 'steel', 'dust'];
export const RUN_LIMITS = { iters: 64, totalIters: 1024, nodes: 512, refDepth: 4 };

export class PlanError extends Error {}
const at = (path, e) => (e instanceof PlanError ? e : new PlanError(`${path}: ${e.message}`));

/* lookup(id) → entity config (or null). cache: Map id → program, shared across one registry. */
export function compileEntity(entity, { lookup = () => null, cache = new Map(), stack = [] } = {}) {
  if (cache.has(entity.id)) return cache.get(entity.id);
  if (stack.includes(entity.id)) throw new PlanError(`${[...stack, entity.id].join(' → ')}: reference cycle`);
  if (stack.length >= RUN_LIMITS.refDepth) throw new PlanError(`${[...stack, entity.id].join(' → ')}: references nested deeper than ${RUN_LIMITS.refDepth}`);
  const inner = [...stack, entity.id], scope = new Scope(), init = [];
  scope.anchor = entity.anchor ?? 'center';
  const sub = id => { const e = lookup(id); if (!e || typeof e !== 'object' || e.id !== id) throw new PlanError(`unknown entity '${id}'`); return compileEntity(e, { lookup, cache, stack: inner }); };
  for (const [k, v] of Object.entries(entity.consts ?? {})) { const i = scope.declare(k); init.push(f => { f[i] = v; }); }
  const params = [];
  for (const [k, p] of Object.entries(entity.params ?? {})) { const i = scope.declare(k), def = p.default; params.push({ name: k, i, def }); }
  for (const [k, v] of Object.entries(entity.vars ?? {})) { const e = wrap(`vars.${k}`, () => compileExpr(v, scope)), i = scope.declare(k); init.push(f => { f[i] = e(f); }); }
  const slots = Object.keys(entity.slots ?? {});
  const body = compileParts(entity.parts ?? [], scope, 'parts', sub);
  const debris = entity.debris == null ? null : (Array.isArray(entity.debris) ? entity.debris : [entity.debris]).map(slot => ({ slot }));
  const prog = {
    id: entity.id, kind: entity.kind, label: entity.label ?? null, entity, params, slots, size: () => scope.root.size,
    /* bind(args) → frame with consts, params (args win over defaults) and vars */
    /* bind(args) → frame: params first (args win over defaults), then consts + vars in declaration order (vars may read both) */
    bind(args) {
      const f = new Array(scope.root.size);
      for (const p of params) { const v = args?.[p.name]; f[p.i] = v === undefined ? p.def : v; }
      for (const k of init) k(f);
      return f;
    },
    runBody: body,
    run(args, sink, { slotMap = null, budget = { iters: 0, nodes: 0 } } = {}) { const f = prog.bind(args); body(f, { sink, slotMap, budget }); return f; },
    debris,
  };
  cache.set(entity.id, prog); return prog;
}

const wrap = (path, f) => { try { return f(); } catch (e) { throw at(path, e); } };
const num3 = (v, scope, path) => {
  if (!Array.isArray(v) || v.length !== 3) throw new PlanError(`${path}: needs [x, y, z]`);
  const [a, b, c] = v.map((x, i) => wrap(`${path}[${i}]`, () => compileExpr(x, scope)));
  return f => [a(f), b(f), c(f)];
};
const one = (v, scope, path) => wrap(path, () => compileExpr(v, scope));

/* material reference → (frame, state) → runtime descriptor */
function compileMat(m, scope, path) {
  if (Array.isArray(m)) { const ms = m.map((x, i) => compileMat(x, scope, `${path}[${i}]`)); return (f, st) => ms.map(x => x(f, st)); }
  if (typeof m === 'string') { const d = { slot: m }; return (f, st) => (st.slotMap ? st.slotMap[m] ?? d : d); }
  if (m && typeof m === 'object') {
    if ('global' in m) { const d = { global: m.global }; return () => d; }
    if ('facade' in m) { const c = one(m.facade[0], scope, `${path}.facade[0]`), r = one(m.facade[1], scope, `${path}.facade[1]`); return f => ({ facade: [c(f), r(f)] }); }
    if ('if' in m) { const c = one(m.if, scope, `${path}.if`), a = compileMat(m.then, scope, `${path}.then`), b = compileMat(m.else, scope, `${path}.else`); return (f, st) => (c(f) ? a(f, st) : b(f, st)); }
    if ('color' in m) { const c = one(m.color, scope, `${path}.color`), lamp = !!m.lamp; return f => ({ color: c(f), lamp }); }
    if ('flag' in m) { const i = one(m.flag, scope, `${path}.flag`), side = m.side ? 1 : 0; return f => ({ flag: i(f), side }); }   // the route's national flag i (side 0 = +x face, 1 = -x), red when it has none
  }
  throw new PlanError(`${path}: unknown material ${JSON.stringify(m)}`);
}

function compileParts(parts, scope, path, sub) {
  if (!Array.isArray(parts)) throw new PlanError(`${path}: must be a list`);
  const ops = parts.map((p, i) => compilePart(p, scope, `${path}[${i}]`, sub));
  return (f, st) => { for (let i = 0; i < ops.length; i++) ops[i](f, st); };
}

function node(st, path) { if (++st.budget.nodes > RUN_LIMITS.nodes) throw new PlanError(`${path}: more than ${RUN_LIMITS.nodes} parts`); }

function compilePart(p, scope, path, sub) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new PlanError(`${path}: a part must be an object`);
  const op = compileBare(p, scope, path, sub);
  const when = p.when != null ? one(p.when, scope, `${path}.when`) : null, ifSlot = p.ifSlot ?? null;
  if (!when && !ifSlot) return op;
  return (f, st) => {
    if (when && !when(f)) return;
    if (ifSlot && !(st.slotMap ? st.slotMap[ifSlot] != null : st.sink.hasSlot(ifSlot))) return;
    op(f, st);
  };
}

function compileBare(p, scope, path, sub) {
  const xf = () => ({ at: p.at != null ? num3(p.at, scope, `${path}.at`) : null, rot: p.rot != null ? num3(p.rot, scope, `${path}.rot`) : null, order: p.order ?? null });
  if ('geo' in p) {
    if (!GEOS.includes(p.geo)) throw new PlanError(`${path}.geo: unknown geometry '${p.geo}'`);
    const s = num3(p.s, scope, `${path}.s`), { at: a, rot, order } = xf(), mat = compileMat(p.mat, scope, `${path}.mat`), base = (p.anchor ?? scope.root.anchor) === 'base', geo = p.geo, tag = p.tag ?? null;
    return (f, st) => {
      node(st, path);
      const [sx, sy, sz] = s(f), [x, y, z] = a ? a(f) : [0, 0, 0];
      st.sink.mesh(geo, mat(f, st), sx, sy, sz, x, base ? y + sy / 2 : y, z, rot ? rot(f) : null, order, tag);
    };
  }
  if ('glow' in p) {
    const g = p.glow, c = one(g.color, scope, `${path}.glow.color`), sz = one(g.size, scope, `${path}.glow.size`), gain = one(g.gain, scope, `${path}.glow.gain`), a = num3(p.at ?? [0, 0, 0], scope, `${path}.at`), role = p.role ?? null;
    return (f, st) => { node(st, path); const [x, y, z] = a(f); st.sink.glow(c(f), sz(f), gain(f), x, y, z, role); };
  }
  if ('beam' in p) {
    const b = p.beam, c = one(b.color, scope, `${path}.beam.color`), gain = one(b.gain, scope, `${path}.beam.gain`), w = one(b.w, scope, `${path}.beam.w`), l = one(b.l, scope, `${path}.beam.l`), z0 = one(b.z0, scope, `${path}.beam.z0`), back = !!b.back;
    return (f, st) => { node(st, path); st.sink.beam(c(f), gain(f), w(f), l(f), z0(f), back); };
  }
  if ('sign' in p) {   // chunky box with the word on every vertical face (landmarks/index.js painters); at.y = BOTTOM of the board
    const g = p.sign, w = one(g.w, scope, `${path}.sign.w`), h = one(g.h, scope, `${path}.sign.h`), a = num3(p.at ?? [0, 0, 0], scope, `${path}.at`), face = { sign: g.style, text: g.text ?? null }, edge = { edge: g.style };
    if (!SIGN_STYLES.includes(g.style)) throw new PlanError(`${path}.sign.style: one of ${SIGN_STYLES.join(', ')}`);
    return (f, st) => {
      node(st, path);
      const W = w(f), H = h(f), [x, y, z] = a(f), d = Math.max(H * .85, Math.min(W * .8, H * 1.5));
      st.sink.mesh('box', [face, face, edge, edge, face, face], d, H, W, x, y + H / 2, z, null, null, 'sign');
    };
  }
  if ('disk' in p) {   // round sign board, face to -x; at.y = CENTRE
    const g = p.disk, r = one(g.r, scope, `${path}.disk.r`), a = num3(p.at ?? [0, 0, 0], scope, `${path}.at`), mats = [{ edge: g.style }, { disk: g.style, text: g.text, back: false }, { disk: g.style, text: g.text, back: true }];
    if (!SIGN_STYLES.includes(g.style)) throw new PlanError(`${path}.disk.style: one of ${SIGN_STYLES.join(', ')}`);
    return (f, st) => { node(st, path); const R = r(f), [x, y, z] = a(f); st.sink.mesh('wheel48', mats, R, .2, R, x, y, z, [0, 0, Math.PI / 2], null, 'sign'); };
  }
  if ('banner' in p) {
    const g = p.banner, w = one(g.w, scope, `${path}.banner.w`), h = one(g.h, scope, `${path}.banner.h`), a = num3(p.at ?? [0, 0, 0], scope, `${path}.at`);
    return (f, st) => { node(st, path); const [x, y, z] = a(f); st.sink.banner(w(f), h(f), x, y, z); };
  }
  if ('group' in p) {
    const g = p.group ?? {}, { at: a, rot, order } = xf(), body = compileParts(p.do ?? [], scope, `${path}.do`, sub), role = g.role ?? null, visible = g.visible !== false;
    return (f, st) => { node(st, path); st.sink.push({ role, visible, at: a ? a(f) : null, rot: rot ? rot(f) : null, order, ref: null }); body(f, st); st.sink.pop(); };
  }
  if ('for' in p) return compileLoop(p, scope, path, sub);
  if ('use' in p || 'ref' in p) {
    const isRef = 'ref' in p, id = isRef ? p.ref : p.use, target = wrap(path, () => sub(id));
    const args = Object.entries(p.with ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.map((x, i) => one(x, scope, `${path}.with.${k}[${i}]`)) : one(v, scope, `${path}.with.${k}`)]);
    const smap = p.slots ? Object.entries(p.slots).map(([k, m]) => [k, compileMat(m, scope, `${path}.slots.${k}`)]) : null;
    const { at: a, rot, order } = isRef ? xf() : { at: null, rot: null, order: null };
    return (f, st) => {
      const vals = {}; for (const [k, e] of args) vals[k] = Array.isArray(e) ? e.map(x => x(f)) : e(f);
      // slots: explicit map in the caller's terms, else pass the caller's slots through by name
      let slotMap = st.slotMap;
      if (smap) { slotMap = Object.create(null); for (const [k, m] of smap) slotMap[k] = m(f, st); }
      const tf = target.bind(vals);
      if (isRef) {
        node(st, path);
        const params = {}; for (const q of target.params) params[q.name] = tf[q.i];
        const debris = target.debris?.map(d => (slotMap ? slotMap[d.slot] ?? d : d)) ?? null;
        st.sink.push({ role: null, visible: true, at: a ? a(f) : null, rot: rot ? rot(f) : null, order, ref: { id: target.id, kind: target.kind, label: target.label, params, debris } });
      }
      target.runBody(tf, { sink: st.sink, slotMap, budget: st.budget });
      if (isRef) st.sink.pop();
    };
  }
  throw new PlanError(`${path}: unknown part (expected geo, glow, beam, sign, disk, banner, group, for, use or ref)`);
}

function compileLoop(p, scope, path, sub) {
  const s = scope.child(), names = Array.isArray(p.for) ? p.for : [p.for];
  let src;   // (frame) → iterator of values (or tuples)
  if ('range' in p) {
    const [a, b] = [one(p.range[0], scope, `${path}.range[0]`), one(p.range[1], scope, `${path}.range[1]`)];
    src = f => { const out = [], hi = b(f); for (let i = a(f); i < hi; i++) { out.push(i); if (out.length > RUN_LIMITS.iters) break; } return out; };
  } else if ('from' in p) {
    const a = one(p.from, scope, `${path}.from`), st = one(p.step, scope, `${path}.step`);
    const zi = s.declare(names[0]), w = one(p.while, s, `${path}.while`);   // `while` sees the loop variable
    src = f => { const out = []; for (f[zi] = a(f); w(f); f[zi] = f[zi] + st(f)) { out.push(f[zi]); if (out.length > RUN_LIMITS.iters) break; } return out; };
    return finish(p, s, [zi], src, path, sub);
  } else if (Array.isArray(p.in)) {
    const rows = p.in.map((r, i) => (Array.isArray(r) ? r.map((x, j) => one(x, scope, `${path}.in[${i}][${j}]`)) : one(r, scope, `${path}.in[${i}]`)));
    src = f => rows.map(r => (Array.isArray(r) ? r.map(x => x(f)) : r(f)));
  } else if ('in' in p) {
    const l = one(p.in, scope, `${path}.in`);
    src = f => { const v = l(f); if (!Array.isArray(v)) throw new PlanError(`${path}.in: not a list`); return v; };
  } else throw new PlanError(`${path}: a loop needs in, range or from/step/while`);
  const idx = names.map(n => wrap(`${path}.for`, () => s.declare(n)));
  return finish(p, s, idx, src, path, sub);
}
function finish(p, s, idx, src, path, sub) {
  const lets = Object.entries(p.let ?? {}).map(([k, v]) => { const e = one(v, s, `${path}.let.${k}`); return [s.declare(k), e]; });
  const body = compileParts(p.do ?? [], s, `${path}.do`, sub);
  return (f, st) => {
    const vals = src(f);
    if (vals.length > RUN_LIMITS.iters) throw new PlanError(`${path}: more than ${RUN_LIMITS.iters} iterations`);
    for (const v of vals) {
      if (++st.budget.iters > RUN_LIMITS.totalIters) throw new PlanError(`${path}: more than ${RUN_LIMITS.totalIters} iterations in all`);
      if (idx.length === 1) f[idx[0]] = Array.isArray(v) && Array.isArray(p.for) ? v[0] : v;
      else { if (!Array.isArray(v) || v.length !== idx.length) throw new PlanError(`${path}: each row needs ${idx.length} values`); for (let k = 0; k < idx.length; k++) f[idx[k]] = v[k]; }
      for (const [i, e] of lets) f[i] = e(f);
      body(f, st);
    }
  };
}

/* Node-side sink: the flat part list the validator and the MCP tools measure. */
export function toParts(prog, args = {}, { slots = null } = {}) {
  const out = [], stack = [{ i: -1, at: [0, 0, 0], rot: null }];
  const parent = () => stack[stack.length - 1].i;
  const sink = {
    hasSlot: n => (slots ? Object.hasOwn(slots, n) : true),
    mesh(geo, mat, sx, sy, sz, x, y, z, rot, order, tag) { out.push({ t: 'mesh', parent: parent(), geo, mat, s: [sx, sy, sz], p: [x, y, z], r: rot, order, tag }); },
    glow(color, size, gain, x, y, z, role) { out.push({ t: 'glow', parent: parent(), color, size, gain, p: [x, y, z], role }); },
    beam(color, gain, w, l, z0, back) { out.push({ t: 'beam', parent: parent(), color, gain, w, l, z0, back }); },
    banner(w, h, x, y, z) { out.push({ t: 'banner', parent: parent(), w, h, p: [x, y, z] }); },
    push(g) { out.push({ t: 'group', parent: parent(), role: g.role, visible: g.visible, p: g.at ?? [0, 0, 0], r: g.rot, order: g.order, ref: g.ref ? { id: g.ref.id, kind: g.ref.kind } : null }); stack.push({ i: out.length - 1 }); },
    pop() { stack.pop(); },
  };
  prog.run(args, sink);
  return out;
}
