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
import { stripPool, strips, finish, buildSpine } from './roadmesh.js';
import { group, releaseTree, poolStats, meshPool, groupPool } from './pool.js';

/* Road is streamed in 32 m chunks around the truck: road surface + markings (world/roadmesh.js, widths from the road network), junctions that fall in the
   chunk (world/junctions.js), the depot (chunk 0), the route's props and roadside furniture (all registered as colliders).
   Roadside things are laid out for the 12 m two-lane road; `place`/`reg` shift them outward with the road edge (net.roadside) and drop what would stand
   on a junction, side road or the depot yard (net.keepOut). RoadObjectManager owns the lifecycle: `startTrip()` pre-warms the pools and builds the initial
   window at the depot, `update(s)` builds the chunks that come into range and hands the ones that fall behind back to the pools (see pool.js). The road never ends. */

export const CH = CFG.CHUNK_LEN, AHEAD = 820, BEHIND = 280;   // keep road behind the truck so the mirrors have something to show
export const chunks = new Map();
export const releaseHooks = new Set();   // fn(obj) called for every object of a chunk that is being recycled (damage.js drops toppling props that still point at it)

function buildChunk(ci) {
  const s0 = ci * CH, grp = group(), pr = env.props, M = env.roadMat;
  const surf = strips(.03), pad = strips(.036), marks = strips(.045);
  buildSpine(surf, marks, s0, s0 + CH);

  const raw = (obj, s, lat, yaw) => { const p = roadAt(s); obj.position.set(p.x + Math.cos(p.t) * lat, 0, p.z + Math.sin(p.t) * lat); obj.rotation.y = yaw ?? -p.t; grp.add(obj); };
  const occ = occupancy(); grp.userData.layout = occ.items;   // what was laid out and where (world/spacing.js): the rule that nothing stands in, or too close to, anything else
  const claim = (obj, s, l) => { const u = obj.userData, k = KINDS[u.kind]; if (!k) return true; const f = footprintOf(u.kind, k(u.size), s, l); f.obj = obj; return occ.claim(f); };
  const place = (obj, s, lat, yaw) => { const l = net.roadside(s, lat); if (net.keepOut(s, l) || !claim(obj, s, l)) releaseTree(obj); else raw(obj, s, l, yaw); };
  const colliders = []; grp.userData.colliders = colliders; grp.userData.heads = [];
  const rawReg = (obj, id, s, lat, extra) => { if (obj.parent !== grp) return; const u = obj.userData, d = KINDS[u.kind](u.size); colliders.push({ obj, id, s, lat, kind: u.kind, size: u.size, hp: d.hp, r: d.r, rf: d.rf ?? d.r, rl: d.rl ?? d.r, dmg: d.dmg, slow: d.slow, cool: 0, dead: false, ...extra }); };
  const reg = (obj, id, s, lat, extra) => { if (extra?.rf) { const f = occ.items.find(o => o.obj === obj); if (f) { f.rf = extra.rf; f.rl = extra.rl; } } rawReg(obj, id, s, net.roadside(s, lat), extra); };   // a building's real footprint comes with its reg
  const siteAt = k => net.busy(k * CH - 20, k * CH + CH + 20) ? null : env.landmarks?.site(k, k * CH) ?? null;
  const lm = siteAt(ci);   // at most one building per chunk; ordinary props stay out of its footprint
  env.landmarks?.build(lm, ci, { place, reg, destroyed });
  env.furniture.build({ ci, s0, place, reg, destroyed, lm, lms: [ci - 1, ci, ci + 1].map(k => k === ci ? lm : siteAt(k)).filter(Boolean) });   // delineator posts / poles / guardrails
  buildHoles(ci, s0, { place, raw, reg, destroyed });   // road holes + the warning signs before them
  // roadside scenery (kinds, density and distances come from the route's props.js); placed LAST, so it is the one that gives way to buildings, guardrails and warning signs
  for (let k = 0; k < pr.slots; k++) {
    const key = ci * 10 + k; if (rnd(key) > pr.density) continue;
    let s = s0 + (k + rnd(key + .5)) * CH / pr.slots; const side = rnd(key + .7) < 0.5 ? -1 : 1, off = pr.near + Math.pow(rnd(key + .9), 1.6) * pr.span;
    const id = ci + ':' + k; if (destroyed.has(id)) continue;
    const prop = pr.pick(rnd(key + .3), rnd(key + .1)), u = prop.userData, d = KINDS[u.kind](u.size);
    s = insideChunk(s, d.rf ?? d.r, s0, CH);
    if (lm && side === lm.side && Math.abs(s - lm.s) < lm.hl + 3 && off < lm.near + lm.hd * 2 + 3) { releaseTree(prop); continue; }
    place(prop, s, side * off, rnd(key) * 6); reg(prop, id, s, side * off);
  }
  for (const j of net.near(s0, s0 + CH)) if (j.s < s0 + CH) buildJunction(j, { surf, pad, marks, place: raw, reg: rawReg, destroyed, heads: grp.userData.heads });
  if (ci === 0) buildDepot({ place: raw, reg: rawReg, destroyed });
  grp.userData.strips = [];
  for (const [m, mat] of [[surf, M.surface], [pad, M.pad], [marks, M.marks]]) if (finish(m, mat)) { grp.add(m); grp.userData.strips.push(m); } else stripPool.release(m);
  scene.add(grp); return grp;
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
  /* on the fly: build what came into range, recycle what fell out of it */
  update(s) {
    const lo = Math.floor((s - BEHIND) / CH), hi = Math.floor((s + AHEAD) / CH);
    for (const [ci, g] of chunks) if (ci < lo || ci > hi) { releaseChunk(g); chunks.delete(ci); }
    for (let ci = Math.max(0, lo); ci <= hi; ci++) if (!chunks.has(ci)) chunks.set(ci, buildChunk(ci));
  }
}
export const roadObjects = new RoadObjectManager();
