import { placeHole, flagHole } from './world/holes.js';
import { roadObjects } from './world/chunks.js';
import { EFFECT_INFO } from './live-effects.js';
import { VEHICLES, buildVehicle, removeVehicle } from './world/vehicles.js';
import { TRAFFIC_TYPES } from './sim/traffic.js';

/* Replay world helpers for watch.js: server hole outcome merging, spectator obstacle placement, and 2 Hz recorded traffic interpolation. */

const RANK = { hit: 4, ignored: 3, unmeasured: 2, avoided: 1, other: 0 };
const TGAP = 1.5;

export function addOutcome(watch, o) {
  const known = watch.road.get(o.hole);
  const merged = !known ? o : { ...known, t: Math.min(known.t, o.t), outcome: RANK[o.outcome] > RANK[known.outcome] ? o.outcome : known.outcome, expected: known.expected + o.expected, got: known.got + o.got };
  watch.road.set(o.hole, merged);
  if (merged.outcome === 'ignored') { const ci = flagHole(merged.hole); if (ci !== null) roadObjects.rebuild(ci); }
}

export function roadCheckFrom(watch) {
  const all = [...watch.road.values()], n = k => all.filter(o => o.outcome === k).length;
  return { holes: all.length, hit: n('hit'), avoided: n('avoided'), ignored: n('ignored'), marks: all.filter(o => o.outcome === 'ignored' || o.outcome === 'hit').sort((a, b) => a.t - b.t) };
}

export function stampPassed(watch, t) {
  if (watch.jumped || watch.roadT < 0 || t <= watch.roadT) { watch.roadT = t; return; }
  for (const o of watch.road.values()) if (o.outcome === 'ignored' && o.t > watch.roadT && o.t <= t) watch.stamp = { ...o, until: performance.now() + 4000 };
  watch.roadT = t;
  if (watch.stamp && performance.now() > watch.stamp.until) watch.stamp = null;
}

export function placeObstacle(e) {
  const hole = EFFECT_INFO[e.effect]?.hole;
  if (!hole || !e.applied || e.applied.placed === false || e.onRoad) return;
  e.onRoad = true; roadObjects.rebuild(placeHole(hole, e.applied.s, e.applied.lat ?? 2.4, `live${e.id}`));
}

export function replaceObstacles(watch) {
  for (const e of watch.events.values()) { e.onRoad = false; placeObstacle(e); }
}

export function drawReplayTraffic(watch, find, t) {
  const F = watch.tframes, i = find(t, F), a = F[i], b = F[i + 1], seen = new Set();
  if (a && t - a[0] <= TGAP) {
    const k = b && b[0] - a[0] <= TGAP ? Math.min(1, (t - a[0]) / Math.max(1e-6, b[0] - a[0])) : 0, next = new Map();
    if (k > 0) for (let j = 1; j + 6 < b.length; j += 7) next.set(b[j], j);
    for (let j = 1; j + 6 < a.length; j += 7) {
      const id = a[j], type = TRAFFIC_TYPES[a[j + 1]], def = VEHICLES[type]; if (!def) continue;
      let car = watch.cars.get(id);
      if (!car) { car = { mesh: buildVehicle(def, a[j + 2]) }; watch.cars.set(id, car); }
      const n = next.get(id), lerpTo = (q, v) => (n === undefined ? v : v + (b[n + q] - v) * k);
      let yaw = a[j + 5]; if (n !== undefined) { let d = b[n + 5] - yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); yaw += d * k; }
      car.mesh.position.set(lerpTo(3, a[j + 3]), 0, lerpTo(4, a[j + 4])); car.mesh.rotation.y = yaw;
      const u = car.mesh.userData, f = a[j + 6];
      if (u.brake) u.brake.visible = !!(f & 1);
      if (u.flash) { const on = Math.floor(t * 6) % 2 === 0; u.flash[0].visible = on && !!(f & 2); u.flash[1].visible = !on && !!(f & 2); }
      seen.add(id);
    }
  }
  for (const [id, car] of watch.cars) if (!seen.has(id)) { removeVehicle(car.mesh); watch.cars.delete(id); }
}
