import { st, chipHull, wreckHull } from '../state.js';
import { CFG } from '../config.js';
import { guide } from '../guide.js';
import { roadAt } from '../road.js';
import { scene } from '../world/scene.js';
import { GEO, MAT, destroyed } from '../world/props.js';
import { chunks, CH, BEHIND, releaseHooks } from '../world/chunks.js';
import { mesh, meshPool } from '../world/pool.js';
import { HOLES, holesNear } from '../world/holes.js';
import { clamp } from '../util.js';
import { audio } from './audio.js';
import { toast } from '../ui/toast.js';
import { glassHit } from './glass-damage.js';
import { addBucket, emptyBuckets, sourceOfLabel } from '../../shared/damage-buckets.js';

/* Collisions, prop destruction, pooled 3D debris particles, and road hole impacts. */
const TRUCK_HALF_W = 1.25, TRUCK_FRONT = 3.3, TRUCK_BACK = -1.6;   // metres from the driver's eye
export const debris = [], falls = [];
releaseHooks.add(o => { for (let i = falls.length - 1; i >= 0; i--) if (falls[i].obj === o) falls.splice(i, 1); });   // a recycled prop must not keep toppling in its next life

export function collide(dt) {   // returns the reason the ride is over when the truck hit a building
  if (st.rev) return null;   // reversing: the trailer has no scenery collision (known gap), so nothing ahead can be hit
  const cs = Math.floor((st.s - 3) / CH), ce = Math.floor((st.s + 5) / CH), cp = Math.cos(st.psi), sp = Math.sin(st.psi);
  for (let ci = cs; ci <= ce; ci++) {
    const grp = chunks.get(ci); if (!grp) continue;
    for (const c of grp.userData.colliders) {
      c.cool = Math.max(0, c.cool - dt); if (c.dead || c.cool > 0) continue;
      const ds = c.s - st.s, dl = c.lat - st.d, f = ds * cp + dl * sp, r = -ds * sp + dl * cp;   // prop in the truck's own frame
      if (f < TRUCK_BACK - c.rf || f > TRUCK_FRONT + c.rf || Math.abs(r) > TRUCK_HALF_W + c.rl) continue;   // rf/rl: reach along / across the road (guardrails are long and thin)
      if (c.kind === 'building') { st.crashB++; wreckHull(); st.crash = 1; st.flash = 1; audio.crash(1); return 'You crashed into a building – the truck is a wreck.'; }   // any contact with a building is fatal
      hit(c, f);
    }
  }
  return null;
}

function hit(c, f) {
  const frontal = f > TRUCK_FRONT - 0.6, iv = st.v * (frontal ? 1 : 0.5), dmg = iv < 1.5 ? 0 : c.dmg / 784 * iv * iv;
  const sgn = Math.sign(c.lat - st.d) || 1;   // +1: prop is on the truck's right
  c.cool = 0.5; c.hp -= Math.max(iv, 2) ** 2 * CFG.IMPACT_MASS; st.noStall = CFG.IMPACT_STALL_GRACE;  // even slow nudges chip away at it
  if (c.hp <= 0) { destroyProp(c); st.v *= 1 - c.slow * CFG.IMPACT_SLOW * (frontal ? 1 : .5); }
  else { st.v *= frontal ? CFG.IMPACT_BOUNCE : CFG.IMPACT_GLANCE; if (frontal) st.s -= .5; st.d -= sgn * .6; st.psi -= sgn * .12; }   // bounce off whatever didn't break
  if (dmg > 0) hurt(dmg, iv);
  else { st.crash = Math.min(1, st.crash + .1); audio.crash(.15); }
}

/* hull loss + shake/flash/sound/glass; iv = impact speed (m/s), label = toast prefix (shared with vehicle collisions) */
export function hurt(dmg, iv, label = 'IMPACT', fatal = false, source = sourceOfLabel(label)) {   // fatal: the hit that wrecks the truck whatever the assist (head-on, rear-end)
  if (guide.assist && !fatal) dmg *= CFG.ASSIST.HULL_DMG;   // assist mode: twice the durability
  if (!st.dmg) st.dmg = emptyBuckets();
  addBucket(st.dmg, source, dmg);
  chipHull(dmg); st.crash = Math.min(1, st.crash + iv / 14 + .15); st.flash = Math.min(1, dmg / 12 + .15);
  audio.crash(Math.min(1, iv / 20)); toast(label + '  −' + dmg.toFixed(1) + '% hull', 1300);
  glassHit(dmg);
}

function destroyProp(c) {
  audio.play('smash', c.kind === 'rock' || c.kind === 'tree' ? 1 : .8); c.dead = true; destroyed.add(c.id);
  if (c.kind === 'lamp' && c.obj.userData.glow) c.obj.userData.glow.visible = false;
  if (c.kind === 'post' || c.kind === 'pole' || c.kind === 'lamp' || c.kind === 'sign') falls.push({ obj: c.obj, ang: 0, w: 0 });   // snaps and topples forward
  else if (c.kind === 'guard') falls.push({ obj: c.obj, ang: 0, w: 0, axis: 'z', sign: -Math.sign(c.lat) });   // rail segment falls outward, away from the road
  else { burst(c); c.obj.parent?.remove(c.obj); }
}

export function burst(c) {
  const o = c.obj.position, th = roadAt(st.s).t + st.psi, fx = Math.sin(th), fz = -Math.cos(th);
  const d = c.obj.userData.debris, mat = Array.isArray(d) ? d[Math.random() * d.length | 0] : d || MAT.dust;   // each prop builder says what it is made of
  const n = c.kind === 'rock' ? 6 + Math.round(c.size * 4) : c.kind === 'tree' ? 10 : 8, sz = c.kind === 'rock' ? .25 + c.size * .2 : c.kind === 'tree' ? .35 : .25;
  for (let i = 0; i < n + 4; i++) {
    const dust = i >= n, m = mesh(GEO.box, dust ? MAT.dust : mat), q = sz * (dust ? 1.4 : .4 + Math.random() * .8);
    m.scale.set(q, q, q); m.position.set(o.x, .3 + Math.random() * .8, o.z); scene.add(m);
    const a = Math.random() * 6.28, sp = 1 + Math.random() * 5;
    debris.push({ m, s: c.s, vx: fx * st.v * .6 + Math.cos(a) * sp, vy: 3 + Math.random() * 5, vz: fz * st.v * .6 + Math.sin(a) * sp, life: dust ? 1 : 2.5, q, spin: (Math.random() - .5) * 10 });
  }
}

export function clearDebris() {
  for (const d of debris) meshPool.release(d.m);
  debris.length = 0; falls.length = 0; holeHit.clear();
}

/* Road holes: not solid. Each wheel axle (front, drive, trailer) entering a pit once = a jolt, hull damage ∝ v², some speed loss and a steering pull towards the wheel that dropped. */
const AXLES = [2.2, -.4, -11.5], WHEEL = 1, holeHit = new Set();
export function hitHoles(dt) {
  if (st.v < .5) return;
  for (const h of holesNear(st.s - 13, st.s + 4)) h.ells.forEach((e, i) => AXLES.forEach((ax, k) => {
    const key = h.id + ':' + i + ':' + k; if (holeHit.has(key)) return;
    for (const side of [-1, 1]) {
      const dl = st.d + side * WHEEL - (h.lat + e.dl), ds = st.s + ax - (h.s + e.ds), la = e.a + st.v * dt * .5;
      if ((dl / e.b) ** 2 + (ds / la) ** 2 < 1) { holeHit.add(key); dropInto(HOLES[h.type], k, side); break; }
    }
  }));
}

function dropInto(T, axle, side) {
  const sc = clamp(st.v / 28, 0, 1.2) ** 2 * (axle ? .6 : 1);
  st.jolt = Math.max(st.jolt, T.jolt * clamp(st.v / 14, .25, 1)); audio.play('pothole', .4 + .6 * clamp(st.v / 20, 0, 1));
  if (st.v < 3) return;   // crawling through: just a bump
  st.v *= 1 - T.slow * sc; st.psi += side * T.kick * sc * 4;
  const dmg = T.dmg * sc;
  if (dmg >= .3) hurt(dmg, st.v * .5, 'POTHOLE'); else { st.crash = Math.min(1, st.crash + .15); audio.crash(.15); }
}

export function updateFX(dt) {
  for (let i = falls.length - 1; i >= 0; i--) {
    const f = falls[i]; f.w += 7 * dt; const d = Math.min(f.w * dt, 1.5 - f.ang); if (f.axis === 'z') f.obj.rotateZ(f.sign * d); else f.obj.rotateX(-d); f.ang += d; if (f.ang >= 1.5) falls.splice(i, 1);
  }
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i], m = d.m; d.life -= dt;
    d.vy -= 16 * dt; m.position.x += d.vx * dt; m.position.y += d.vy * dt; m.position.z += d.vz * dt; m.rotation.x += d.spin * dt; m.rotation.z += d.spin * dt;
    if (m.position.y < d.q / 2) { m.position.y = d.q / 2; d.vy *= -.3; d.vx *= .6; d.vz *= .6; d.spin *= .5; }
    if (d.life < .5) m.scale.setScalar(Math.max(.001, d.q * d.life * 2));
    if (d.life <= 0 || (d.s !== undefined && st.s - d.s > BEHIND)) { meshPool.release(m); debris.splice(i, 1); }
  }
}
