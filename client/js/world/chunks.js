import { CFG } from '../config.js';
import { roadAt } from '../road.js';
import { net } from '../net/network.js';
import { rnd } from '../util.js';
import { scene } from './scene.js';
import { KINDS, destroyed } from './props.js';
import { env } from './environment.js';
import { buildHoles } from './holes.js';
import { footprintOf, insideChunk, occupancy } from './spacing.js';
import { buildJunction, heads } from './junctions.js';
import { buildDepot } from './depot.js';
import { stripPool, strips, finish, buildSpine, buildAlt } from './roadmesh.js';
import { group, releaseTree, poolStats, meshPool, groupPool } from './pool.js';
import { trip } from '../trips.js';

/* Road is streamed in 32 m chunks around the truck: road surface + markings (world/roadmesh.js, widths from the road network), junctions that fall in the
   chunk (world/junctions.js), the depot (chunk 0), the route's props and roadside furniture (all registered as colliders).
   Roadside things are laid out for the 12 m two-lane road; `place`/`reg` shift them outward with the road edge (net.roadside) and drop what would stand
   on a junction, side road or the depot yard (net.keepOut). RoadObjectManager owns the lifecycle: `startTrip()` pre-warms the pools and builds the initial
   window at the depot, `update(s)` builds the chunks that come into range and hands the ones that fall behind back to the pools (see pool.js). The road never ends. */

export const CH = CFG.CHUNK_LEN, AHEAD = 820, BEHIND = 280;   // keep road behind the truck so the mirrors have something to show
export const chunks = new Map();
export const releaseHooks = new Set();   // fn(obj) called for every object of a chunk that is being recycled (damage.js drops toppling props that still point at it)

function buildChunk(ci) {
  const s0 = ci * CH, grp = group(), M = env.roadMat;
  const surf = strips(.03), pad = strips(.036), marks = strips(.045);
  buildSpine(surf, marks, s0, s0 + CH);
  const colliders = []; grp.userData.colliders = colliders; grp.userData.heads = [];
  const fk = net.forksNear(s0, s0 + CH)[0] ?? null;
  roadside(ci, grp, false, fk, colliders);
  for (const j of net.near(s0, s0 + CH)) if (j.s < s0 + CH) buildJunction(j, { surf, pad, marks, place: (o, s, l, y) => putAt(grp, roadAt, o, s, l, y), reg: (obj, id, s, lat, extra) => regAt(grp, colliders, obj, id, s, lat, extra), destroyed, heads: grp.userData.heads });
  if (ci === 0) buildDepot({ place: (o, s, l, y) => putAt(grp, roadAt, o, s, l, y), reg: (obj, id, s, lat, extra) => regAt(grp, colliders, obj, id, s, lat, extra), destroyed });
  const out = [[surf, M.surface], [pad, M.pad], [marks, M.marks]];
  if (fk) {   // a fork: the OTHER road too – its ribbon (just under the spine's, so the shared apron does not flicker), its roadside and its holes, drawn only (no colliders)
    const asurf = strips(.024), amarks = strips(.043); buildAlt(asurf, amarks, Math.max(s0, fk.f0), Math.min(s0 + CH, fk.f1));
    roadside(ci, grp, true, fk, null); out.push([asurf, M.surface], [amarks, M.marks]);
  }
  grp.userData.strips = [];
  for (const [m, mat] of out) if (finish(m, mat)) { grp.add(m); grp.userData.strips.push(m); } else stripPool.release(m);
  scene.add(grp); return grp;
}
const putAt = (grp, at, obj, s, lat, yaw) => { const p = at(s); obj.position.set(p.x + Math.cos(p.t) * lat, 0, p.z + Math.sin(p.t) * lat); obj.rotation.y = yaw ?? -p.t; grp.add(obj); };
function regAt(grp, colliders, obj, id, s, lat, extra) { if (obj.parent !== grp) return; const u = obj.userData, d = KINDS[u.kind](u.size); colliders.push({ obj, id, s, lat, kind: u.kind, size: u.size, hp: d.hp, r: d.r, rf: d.rf ?? d.r, rl: d.rl ?? d.r, dmg: d.dmg, slow: d.slow, cool: 0, dead: false, ...extra }); }

/* a chunk's roadside (buildings, furniture, holes + their signs, scenery) along the spine – or, alt, along the other road of fork `fk` (drawn only: the
   truck can only hit what stands by the road it is on, and after a switch the chunk is rebuilt with that road as the spine). Ids of what stands by
   road 1 of a fork carry 'b:' (chunks wholly inside the fork only – a chunk across the split / merge keeps plain ids, so what was smashed just before the
   split stays smashed when the chunk is rebuilt for the other road), so a prop smashed by one road stays whole by the other. */
function roadside(ci, grp, alt, fk, colliders) {
  const s0 = ci * CH, pr = env.props, at = alt ? s => net.altAt(s) : roadAt;
  const pre = fk && fk.f0 <= s0 && fk.f1 >= s0 + CH && (alt ? 1 - fk.choice : fk.choice) === 1 ? 'b:' : '', dz = pre ? { has: id => destroyed.has(pre + id) } : destroyed;
  const raw = alt ? (obj, s, lat, yaw) => { if (s < fk.f0 || s > fk.f1) releaseTree(obj); else putAt(grp, at, obj, s, lat, yaw); } : (obj, s, lat, yaw) => putAt(grp, at, obj, s, lat, yaw);   // the other road exists only inside its fork
  const occ = occupancy(); if (!alt) grp.userData.layout = occ.items;   // what was laid out and where (world/spacing.js): the rule that nothing stands in, or too close to, anything else
  const claim = (obj, s, l) => { const u = obj.userData, k = KINDS[u.kind]; if (!k) return true; const f = footprintOf(u.kind, k(u.size), s, l); f.obj = obj; return occ.claim(f); };
  const place = (obj, s, lat, yaw) => { const l = net.roadside(s, lat); if (net.keepOut(s, l, alt) || !claim(obj, s, l)) releaseTree(obj); else raw(obj, s, l, yaw); };
  const rawReg = alt ? () => {} : (obj, id, s, lat, extra) => regAt(grp, colliders, obj, pre + id, s, lat, extra);
  const reg = (obj, id, s, lat, extra) => { if (extra?.rf) { const f = occ.items.find(o => o.obj === obj); if (f) { f.rf = extra.rf; f.rl = extra.rl; } } rawReg(obj, id, s, net.roadside(s, lat), extra); };   // a building's real footprint comes with its reg
  const siteAt = k => net.busy(k * CH - 20, k * CH + CH + 20) ? null : env.landmarks?.site(k, k * CH) ?? null;
  const lm = siteAt(ci);   // at most one building per chunk; ordinary props stay out of its footprint
  env.landmarks?.build(lm, ci, { place, reg, destroyed: dz });
  env.furniture.build({ ci, s0, place, reg, destroyed: dz, lm, lms: [ci - 1, ci, ci + 1].map(k => k === ci ? lm : siteAt(k)).filter(Boolean) });   // delineator posts / poles / guardrails
  buildHoles(ci, s0, { place, raw, reg, destroyed: dz });   // road holes + the warning signs before them (a fork's two roads have the same holes: they are one road in (s, d))
  // roadside scenery (kinds, density and distances come from the route's props.js); placed LAST, so it is the one that gives way to buildings, guardrails and warning signs
  for (let k = 0; k < pr.slots; k++) {
    const key = ci * 10 + k; if (rnd(key) > pr.density * trip.props) continue;   // trip.props: the ride tier's scenery density (trips.js)
    let s = s0 + (k + rnd(key + .5)) * CH / pr.slots; const side = rnd(key + .7) < 0.5 ? -1 : 1, off = pr.near + Math.pow(rnd(key + .9), 1.6) * pr.span;
    const id = ci + ':' + k; if (dz.has(id)) continue;
    const prop = pr.pick(rnd(key + .3), rnd(key + .1)), u = prop.userData, d = KINDS[u.kind](u.size);
    s = insideChunk(s, d.rf ?? d.r, s0, CH);
    if (lm && side === lm.side && Math.abs(s - lm.s) < lm.hl + 3 && off < lm.near + lm.hd * 2 + 3) { releaseTree(prop); continue; }
    place(prop, s, side * off, rnd(key) * 6); reg(prop, id, s, side * off);
  }
}

/* hand a chunk back: the ribbon, then every pooled prop mesh/group under it. Props smashed by the truck were detached from the chunk (damage.js) – they are found through their colliders. */
function releaseChunk(g) {
  for (const c of g.userData.colliders) if (!c.obj.parent) releaseTree(c.obj, onRelease);
  for (const m of g.userData.strips) stripPool.release(m);
  for (const h of g.userData.heads) heads.delete(h);
  scene.remove(g); releaseTree(g, onRelease);
}
function onRelease(o) {
  if (o.userData.disposable) { o.geometry.dispose?.(); o.material.map?.dispose?.(); o.material.dispose?.(); }   // the gantry banner is the one thing built per chunk that is not shared
  for (const f of releaseHooks) f(o);
}

class RoadObjectManager {
  get stats() { return { ...poolStats(), strip: stripPool.stats, chunks: chunks.size }; }
  /* a new ride / a route switch: recycle everything that is out there */
  clear() { for (const [, g] of chunks) releaseChunk(g); chunks.clear(); }
  /* the depot: size the pools (so the first seconds don't allocate) and lay out the initial obstacles ahead of the truck */
  startTrip() {
    this.clear();
    meshPool.prewarm(CFG.POOL_MESHES); groupPool.prewarm(CFG.POOL_GROUPS); stripPool.prewarm(CFG.POOL_CHUNKS * 2);
    this.update(0);
  }
  /* a chunk's content changed after it was built (a spectator's obstacle arrived late in a replay): rebuild it and the ones before it that carry its warning sign */
  rebuild(ci) {
    for (let k = ci - Math.ceil(CFG.HOLE_WARN / CH) - 1; k <= ci; k++) { const g = chunks.get(k); if (g) { releaseChunk(g); chunks.set(k, buildChunk(k)); } }
  }
  /** the road between s0 and s1 changed (a fork was switched): rebuild the chunks of it that are built */
  rebuildRange(s0, s1) {
    for (let ci = Math.floor(s0 / CH); ci <= Math.floor(s1 / CH); ci++) { const g = chunks.get(ci); if (g) { releaseChunk(g); chunks.set(ci, buildChunk(ci)); } }
  }
  /* on the fly: build what came into range, recycle what fell out of it */
  update(s) {
    const lo = Math.floor((s - BEHIND) / CH), hi = Math.floor((s + AHEAD) / CH);
    for (const [ci, g] of chunks) if (ci < lo || ci > hi) { releaseChunk(g); chunks.delete(ci); }
    for (let ci = Math.max(0, lo); ci <= hi; ci++) if (!chunks.has(ci)) chunks.set(ci, buildChunk(ci));
  }
}
export const roadObjects = new RoadObjectManager();
