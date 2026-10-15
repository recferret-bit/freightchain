import * as THREE from 'three';
import { GEO, MAT, mk } from './props.js';
import { group } from './pool.js';
import { glow, beam } from './glow.js';
import { program } from './entities.js';
import { ROSTER } from '../../shared/entity/roster.js';
import { Scope, compileExpr } from '../../shared/entity/expr.js';
import { colorMat } from '../themes/_shared/mats.js';

/* Builds an entity (client/shared/entity/plan.js) into three.js objects with the game's own primitives: mk() meshes from the pools,
   glow() sprites, beam() light pools. Which material a descriptor means is the caller's `ctx`:
     ctx.slot(name)  – a theme / landmark material      ctx.color(hex, lamp) – a fixed colour (default: a theme-scoped cache)
     ctx.facade / sign / edge / disk / flag / banner  – the landmark and gantry painters (they stay in code).
   Pools: a prop or furniture root (and a prop referenced by a landmark) is a pooled group(); everything else a new Group – as before the conversion. */

class Sink {
  constructor(root, ctx, top) { this.stack = [root]; this.ctx = ctx; this.top = top; this.roles = {}; }
  get parent() { return this.stack[this.stack.length - 1]; }
  hasSlot(n) { return this.ctx.slot(n) != null; }
  mat(d) { return Array.isArray(d) ? d.map(x => resolve(this.ctx, x)) : resolve(this.ctx, d); }
  mesh(geo, mat, sx, sy, sz, x, y, z, rot, order) {
    const m = mk(GEO[geo], this.mat(mat), sx, sy, sz, x, y, z);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (order) m.rotation.order = order;
    this.parent.add(m);
  }
  glow(color, size, gain, x, y, z, role) { const s = glow(color, size, gain, x, y, z); this.parent.add(s); if (role) this.role(role, s); }
  beam(color, gain, w, l, z0, back) { this.parent.add(beam(color, gain, w, l, z0, back)); }
  banner(w, h, x, y, z) { this.parent.add(this.ctx.banner(w, h, x, y, z)); }
  push(g) {
    const r = g.ref, node = r && (r.kind === 'prop' || r.kind === 'furniture') ? propRoot(r.id, r.params, r.debris.map(d => resolve(this.ctx, d)), r.label) : new THREE.Group();
    if (g.at) node.position.set(g.at[0], g.at[1], g.at[2]);
    if (g.rot) node.rotation.set(g.rot[0], g.rot[1], g.rot[2]);
    if (g.order) node.rotation.order = g.order;
    if (!g.visible) node.visible = false;
    this.parent.add(node); this.stack.push(node);
    if (g.role) this.role(g.role, node);
  }
  pop() { this.stack.pop(); }
  role(r, o) {   // the handles the game toggles: userData.ind {l, r} (indicators), brake, flash [a, b] (siren), glow (a lamp's light)
    const u = this.top.userData;
    if (r === 'ind.l' || r === 'ind.r') (u.ind ??= {})[r.slice(4)] = o;
    else if (r === 'brake') u.brake = o;
    else if (r === 'flash.0' || r === 'flash.1') (u.flash ??= [])[+r.slice(6)] = o;
    else this.roles[r] = o;
  }
}
function resolve(ctx, d) {
  if (d.slot !== undefined) { const m = ctx.slot(d.slot); if (m == null) throw new Error(`no material for slot '${d.slot}'`); return m; }
  if (d.color !== undefined) return (ctx.color ?? colorMat)(d.color, d.lamp);
  if (d.global !== undefined) return MAT[d.global];
  if (d.facade !== undefined) return ctx.facade(d.facade[0], d.facade[1]);
  if (d.sign !== undefined) return ctx.sign(d.sign, d.text);
  if (d.edge !== undefined) return ctx.edge(d.edge);
  if (d.disk !== undefined) return ctx.disk(d.disk, d.text, d.back);
  if (d.flag !== undefined) return ctx.flag(d.flag, d.side);
  throw new Error(`unknown material ${JSON.stringify(d)}`);
}

/* Build entity `id` into an existing group (vehicles, landmarks, the gantry): `top` gets the role handles in its userData. */
export function buildInto(root, id, params, ctx) { const sink = new Sink(root, ctx, root); program(id).run(params, sink); return sink; }

/* A placed prop / furniture piece: pooled root + the collision description the game reads (userData { kind, size, debris }, from roster.js). */
const sizeFns = new Map();
function sizeOf(id, lock, params) {
  if (typeof lock.size === 'number') return lock.size;
  let f = sizeFns.get(id);
  if (!f) {
    const p = program(id), s = new Scope(); for (const q of p.params) s.declare(q.name);
    const e = compileExpr(lock.size, s); f = args => e(p.params.map(q => (args?.[q.name] === undefined ? q.def : args[q.name]))); sizeFns.set(id, f);
  }
  return f(params);
}
const lockOf = id => ROSTER.prop[id] ?? ROSTER.furniture[id] ?? null;
function propRoot(id, params, debris, label) {
  const g = group(), lock = lockOf(id); if (label) g.name = label;
  g.userData = { kind: lock?.kind ?? 'none', size: lock ? sizeOf(id, lock, params) : 1, debris: debris.length === 1 && !Array.isArray(program(id).entity.debris) ? debris[0] : debris };
  return g;
}
/* slots → ctx: a slot missing from `slots` falls back to the entity's declared default slot (rock's m2 = m1) */
export function themeCtx(id, slots) {
  const decl = program(id).entity.slots ?? {};
  const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);   // never a prototype member ('constructor')
  return { slot: n => own(slots, n) ?? (own(decl, n)?.default ? own(slots, decl[n].default) : undefined) ?? null };
}
const builtFrom = new WeakMap();   // root → entity id (the model viewer's catalogue names variants by it)
export const entityOf = o => builtFrom.get(o) ?? null;
export function prop(id, params, slots) {
  const p = program(id), ctx = themeCtx(id, slots), root = group(), lock = lockOf(id); builtFrom.set(root, id);
  if (p.label && p.kind === 'prop') root.name = p.label;
  const sink = new Sink(root, ctx, root); p.run(params, sink);
  const debris = (p.debris ?? []).map(d => resolve(ctx, d));
  root.userData = { kind: lock?.kind ?? 'none', size: lock ? sizeOf(id, lock, params) : 1, debris: Array.isArray(p.entity.debris) ? debris : debris[0] ?? null };
  for (const [k, o] of Object.entries(sink.roles)) root.userData[k] = o;
  return root;
}
