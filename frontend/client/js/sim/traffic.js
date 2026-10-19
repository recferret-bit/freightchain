import { CFG } from '../config.js';
import { st } from '../state.js';
import { roadAt } from '../road.js';
import { net } from '../net/network.js';
import { buildVehicle, removeVehicle } from '../world/vehicles.js';
import { hurt } from './damage.js';
import { audio } from './audio.js';
import { HOLES, holesNear } from '../world/holes.js';
import { trip } from '../trips.js';
import { createTrafficSimulation } from '../../shared/traffic-simulation.js';
import { TRAFFIC_TYPES } from '../../shared/traffic.js';
export { TRAFFIC_TYPES };

const simulation = createTrafficSimulation({ config: CFG, state: st, roadAt, net, holes: HOLES, holesNear, trip, buildVehicle, removeVehicle, place, hurt, audio });
export const { cars, MAIN, spawn, clearStretch } = simulation;
// Preserve the menu preview's old seed draw; rides always pass their server-derived seed explicitly.
export function resetTraffic(seed) { simulation.resetTraffic(seed ?? (CFG.TRAFFIC ? Math.random() * 4294967296 >>> 0 : undefined)); }

let beginTrafficFrame = () => null, endTrafficFrame = () => {};
export function setTrafficRecorder(begin, end) { beginTrafficFrame = begin; endTrafficFrame = end; }
export function updateTraffic(dt) {
  const frame = beginTrafficFrame(dt), fatal = simulation.updateTraffic(dt);
  endTrafficFrame(frame);
  return fatal;
}

const VIS_EASE = 9;
function place(a, dt = 0) {   // (spawn: no dt – an undefined one made vs / vl NaN and every car's mesh vanished)
  const k = Math.exp(-VIS_EASE * dt); a.vs *= k; a.vl *= k;
  const p = a.road.at(a.s + a.dir * a.vs), m = a.mesh, lat = a.lat + a.vl;
  m.position.set(p.x + Math.cos(p.t) * lat, 0, p.z + Math.sin(p.t) * lat);
  m.rotation.y = -(p.t + (a.dir < 0 ? Math.PI : 0) + a.dir * Math.atan2(a.lv, Math.max(a.v, 3)));
  const u = m.userData; if (u.brake) u.brake.visible = a.brake;
  if (u.ind) {   // indicate where the car is going, including a hole dodge (dLat). Using the lane centre lights the return direction while it is still swerving out.
    const aim = a.dLat ?? a.target, dl = (aim - a.lat) * a.dir, sig = Math.abs(aim - a.lat) > .4 ? (dl > 0 ? 'r' : 'l') : '', on = Math.floor(a.t * 3) % 2 === 0;
    const warn = a.state === 'crashed' || a.state === 'honk' || a.state === 'back' || a.state === 'hold';   // hazard lights: both blink
    u.ind.r.visible = (sig === 'r' || warn) && on; u.ind.l.visible = (sig === 'l' || warn) && on;
  }
  if (u.flash) { const on = Math.floor(a.t * 6) % 2 === 0; u.flash[0].visible = on; u.flash[1].visible = !on; }
}

export function trafficSnapshot(range = 400, max = 16) {
  const p = roadAt(st.s), tx = p.x + Math.cos(p.t) * st.d, tz = p.z + Math.sin(p.t) * st.d, near = [];
  for (const a of cars) { const m = a.mesh.position, d = Math.hypot(m.x - tx, m.z - tz); if (d <= range) near.push([d, a]); }
  near.sort((x, y) => x[0] - y[0]);
  const out = [], r = (v, k) => Math.round(v * k) / k;
  for (const [, a] of near.slice(0, max)) {
    const m = a.mesh, u = m.userData;
    out.push(a.id, TRAFFIC_TYPES.indexOf(a.def.type), a.pick, r(m.position.x, 10), r(m.position.z, 10), r(m.rotation.y, 1000), (a.brake ? 1 : 0) | (u.flash ? 2 : 0));
  }
  return out;
}
