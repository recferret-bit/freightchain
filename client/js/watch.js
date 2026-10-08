import { setLoadout } from './cosmetics.js';
import { CFG } from './config.js';
import { st, dn } from './state.js';
import { API_BASE } from './hosts.js';
import { roadAt } from './road.js';
import { net } from './net/network.js';
import { FLAGS } from './telemetry.js';
import { bodySway, trailerYaw } from './sim/physics.js';
import { wip } from './cockpit/windscreen.js';
import { placeHole } from './world/holes.js';
import { roadObjects } from './world/chunks.js';
import { selectTheme } from './world/theme-manager.js';
import { env } from './world/environment.js';
import { THEMES } from './themes/index.js';
import { EFFECT_INFO, advanceCursor } from './live-effects.js';
import { store } from './util.js';
import { VEHICLES, buildVehicle, removeVehicle } from './world/vehicles.js';
import { TRAFFIC_TYPES } from './sim/traffic.js';

/* Live streams, the SPECTATOR's side: play.html?watch=<rideId>. OPT-IN like online.js – without ?watch nothing here runs.
   No video and no WebSockets: the page polls GET /api/watch/:id and REPLAYS the ride's verified-play recording (10 Hz samples, uploaded every ~15 s) on its
   own copy of the road – the layout is a pure function of the seed + route, so it is the driver's road. A live view therefore runs about LIVE_LAG behind.
   What is replayed: the truck (position, heading, speed, revs, gear, pedals, hull), the clock hour, lights / wipers / heater / parking brake, the signal
   clock, the obstacles spectators paid for (placed where the driver's game stamped them), the traffic around the truck (recorded at 2 Hz beside each batch –
   recordings from before that show an empty road). What is NOT: windscreen cracks, debris, the radio. Nothing is simulated: st is written from the samples
   every frame (st.watch stops the sim and input). */
const POLL_LIVE_MS = 4000, POLL_REPLAY_MS = 10_000;
export const LIVE_LAG = 25;                 // s behind the newest recorded second: one ~15 s batch + its upload, with room for jitter
const PREFETCH = 90;                        // s of recording kept loaded ahead of the playhead in a replay
const GAP = 2;                              // s between two samples = a hole in what is loaded (a seek) – hold there until it is fetched

const viewerId = () => { let v = store.get('freightchain.viewer'); if (!v || !/^[A-Za-z0-9_-]{8,64}$/.test(v)) { v = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); store.set('freightchain.viewer', v); } return v; };

export const watch = {
  id: null, ride: null, error: '', now: 0, skew: 0,
  features: { chat: true, donations: true, payment: 'mock', effects: true },   // what spectators may do on THIS ride (the server's LIVE_* flags)
  rec: { lastSeq: null, t1: 0 }, batches: new Map(), rows: [], tframes: [], cars: new Map(), rowsSeq: -1, events: new Map(), cursor: 0, since: 0, totals: { messages: 0, donations: 0, lamports: 0 }, viewers: 0,
  wt: 0, playing: true, speed: 1, follow: true, buffering: false, seeking: false, started: false, jumped: true, lastHull: 100, timer: 0, polling: null,
  onUpdate: null, onEvent: null,   // set by ui/watch-panel.js: repaint the panel / a new feed line
};
const BATCH = () => CFG.TELEMETRY_BATCH_SECONDS;

/* the first poll, awaited by main.js before the scene is reset (it needs the seed + route) */
export async function initWatch() {
  const id = typeof location === 'undefined' ? null : new URL(location.href).searchParams.get('watch');
  if (!id) return false;
  watch.id = id; st.watch = true;
  try { await poll(0); } catch (e) { watch.error = e.message; }
  return true;
}

async function get(from) {
  const q = new URLSearchParams({ from: String(from), after: String(watch.cursor), since: String(watch.since), viewer: viewerId() });   // since: stamps that came after the cursor moved on
  const r = await fetch(`${API_BASE}/api/watch/${encodeURIComponent(watch.id)}?${q}`, { credentials: 'include', signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 404 ? 'this ride does not exist or has not started yet' : j.detail || j.title || `server error ${r.status}`);
  return j;
}

/* one poll: the ride, recording batches from `from`, new feed events */
async function poll(from) {
  const j = await get(from);
  const first = !watch.ride;
  watch.ride = j.ride; watch.now = j.now; watch.skew = j.now - Date.now(); watch.rec = j.recording; watch.totals = j.totals; watch.viewers = j.viewers; if (j.features) watch.features = j.features;
  if (first) { CFG.RIDE_MIN_SECONDS = j.ride.minSeconds; CFG.COMPLETE_DIST = j.ride.completeDist; watch.follow = j.ride.live; setLoadout(j.ride.loadout); }   // what the driver wore (null = all classic): a replay draws the cockpit it was really driven in
  if (watch.started && j.ride.route && j.ride.route !== env.theme?.id && THEMES.some(t => t.id === j.ride.route)) { selectTheme(j.ride.route, false); replaceObstacles(); }   // the route arrives with the driver's first heartbeat (it re-rolls the road: obstacles again)
  if (j.batches.length) addBatches(j.batches);
  for (const e of j.events) addEvent(e);
  watch.cursor = advanceCursor(watch.cursor, j.events, j.now);
  watch.since = j.now - 5000;   // the driver stamps an effect seconds (or minutes) after it was posted: ask for stamps from a little before this poll
  watch.onUpdate?.();
  return j;
}
const KEEP_BATCHES = 160, KEEP_AROUND = 600;   // ≈ 40 min loaded at most; beyond that, batches more than 10 min from the playhead are dropped (a seek fetches them again)
const usable = r => Number.isFinite(r[0]);
/* the common case – a live ride's next batches, a replay playing on – only appends; a seek, a gap filled or pruning rebuilds the whole array (seq order = time order) */
function addBatches(list) {
  const fresh = list.filter(b => !watch.batches.has(b.seq)).sort((a, b) => a.seq - b.seq);
  if (!fresh.length) return;
  for (const b of fresh) watch.batches.set(b.seq, b);
  let pruned = false;
  if (watch.batches.size > KEEP_BATCHES) for (const [seq, b] of watch.batches) if (b.t1 < watch.wt - KEEP_AROUND || b.t0 > watch.wt + PREFETCH + KEEP_AROUND) { watch.batches.delete(seq); pruned = true; }
  if (!pruned && fresh[0].seq === watch.rowsSeq + 1 && fresh.every((b, i) => b.seq === fresh[0].seq + i)) for (const b of fresh) { watch.rows.push(...b.samples.filter(usable)); watch.tframes.push(...(b.traffic ?? []).filter(usable)); }
  else { const all = [...watch.batches.values()].sort((a, b) => a.seq - b.seq); watch.rows = all.flatMap(b => b.samples).filter(usable); watch.tframes = all.flatMap(b => b.traffic ?? []).filter(usable); }
  watch.rowsSeq = Math.max(...watch.batches.keys());
}
/** a feed event, new or seen again with its stamp (also the panel's own posts – it shows them at once) */
export function addEvent(e) {
  const known = watch.events.get(e.id);
  if (known) { if (!known.applied && e.applied) { known.applied = e.applied; placeObstacle(known); watch.onEvent?.(known, 'applied'); } return; }
  watch.events.set(e.id, e); placeObstacle(e); watch.onEvent?.(e, 'new');
}
/* an obstacle a spectator paid for sits where the driver's game put it (its stamp) – placed as soon as it is known, so it is on the road when the replay
   gets there; one the driver's game found no room for (applied.placed false) is not on the road */
function placeObstacle(e) {
  const hole = EFFECT_INFO[e.effect]?.hole;
  if (!hole || !e.applied || e.applied.placed === false || e.onRoad) return;
  e.onRoad = true; roadObjects.rebuild(placeHole(hole, e.applied.s, e.applied.lat ?? 2.4, `live${e.id}`));
}
/* after resetRide (which re-rolls the road and clears placed holes) */
const replaceObstacles = () => { for (const e of watch.events.values()) { e.onRoad = false; placeObstacle(e); } };
export function startWatch() {
  replaceObstacles();
  watch.started = true; watch.jumped = true;
  watch.wt = watch.follow ? liveTarget() : (watch.rows[0]?.[0] ?? 0); watch.seeking = watch.follow;   // joining a live ride: hold until the live edge is loaded
  schedule(0);
}

/* ───────── fetching: what the playhead needs next ───────── */
const loadedAt = t => { for (const b of watch.batches.values()) if (t >= b.t0 - .05 && t <= b.t1 + .05) return b.seq; return null; };
function wantFrom() {   // the first seq the playhead will need that is not loaded yet; null = nothing to fetch
  const last = watch.rec.lastSeq;
  if (last === null) return 0;
  const here = loadedAt(watch.wt) ?? Math.max(0, Math.min(last, Math.floor(watch.wt / BATCH())));
  for (let s = Math.max(0, here - 1); s <= last; s++) {
    if (watch.batches.has(s)) { if (watch.batches.get(s).t0 > watch.wt + PREFETCH && !watch.follow) return null; continue; }
    return s;
  }
  return last + 1;   // all loaded: ask for whatever comes next (a live ride grows)
}
function schedule(ms) { clearTimeout(watch.timer); watch.timer = setTimeout(tick, ms); }
async function tick() {
  if (!watch.polling) {
    const from = wantFrom() ?? (watch.rec.lastSeq ?? -1) + 1;
    watch.polling = poll(from).catch(e => { watch.error = e.message; watch.onUpdate?.(); }).finally(() => { watch.polling = null; });
    await watch.polling;
  }
  const again = wantFrom(), behind = again !== null && again <= (watch.rec.lastSeq ?? -1);   // more recording is there than loaded: fetch on at once
  schedule(behind ? 50 : watch.ride?.live ? POLL_LIVE_MS : POLL_REPLAY_MS);
}

/* ───────── playback ───────── */
export const recordedEnd = () => watch.rows.at(-1)?.[0] ?? 0;
export const liveTarget = () => Math.max(watch.rows[0]?.[0] ?? 0, watch.rec.t1 - LIVE_LAG);
/* a seek to a part that is not loaded yet HOLDS the target (seeking) until it is fetched, instead of snapping back to what is loaded */
export function seek(t) { watch.follow = false; watch.wt = Math.max(0, Math.min(t, watch.rec.t1)); watch.jumped = true; watch.seeking = true; schedule(0); }
export function goLive() { watch.follow = true; watch.speed = 1; watch.playing = true; watch.wt = liveTarget(); watch.jumped = true; watch.seeking = true; schedule(0); }

function find(t, R = watch.rows) {   // index of the last row at or before t (binary search)
  let lo = 0, hi = R.length - 1;
  if (!R.length || t < R[0][0]) return -1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (R[m][0] <= t) lo = m; else hi = m - 1; }
  return lo;
}
const lerp = (a, b, k) => a + (b - a) * k;
const hourLerp = (a, b, k) => { let d = b - a; if (d > 12) d -= 24; else if (d < -12) d += 24; return (a + d * k + 24) % 24; };

/** every frame instead of the sim (main.js) */
export function stepWatch(dt) {
  if (!watch.started || !watch.rows.length) return;
  const live = watch.ride?.live && watch.follow;
  const R = watch.rows;
  /* the effects the sim would fade (it never runs here): a hit's shake, red flash and rumble must die away, or one recorded hit tints the replay for good */
  st.jolt = Math.max(0, st.jolt - dt * 2.5); st.crash = Math.max(0, st.crash - dt * 2.2); st.flash = Math.max(0, st.flash - dt * 1.6); st.rumble = Math.max(0, st.rumble - dt * .7);
  if (watch.seeking) {   // hold the target until a sample at (or right before) it is loaded – the frame keeps the last picture meanwhile
    if (live) watch.wt = liveTarget();
    const i = find(watch.wt), a = R[i], b = R[i + 1];
    if (!a || (!b ? watch.wt - a[0] > GAP : b[0] - a[0] > GAP && watch.wt - a[0] > GAP)) { watch.buffering = true; return; }
    watch.seeking = false;
  }
  if (watch.playing) {
    let rate = watch.speed;
    if (live) { const lag = liveTarget() - watch.wt; if (Math.abs(lag) > 60) { watch.wt = liveTarget(); watch.jumped = true; } else rate = 1 + Math.max(-.3, Math.min(.5, lag / 20)); }   // ease towards LIVE_LAG behind the edge
    watch.wt += dt * rate;
  }
  let i = find(watch.wt);
  if (i < 0) { watch.wt = R[0][0]; i = 0; }
  const a = R[i], b = R[i + 1];
  watch.buffering = !b || b[0] - a[0] > GAP;   // at the end of what is loaded (live edge, a seek, a missing batch): hold the last frame
  if (watch.buffering) watch.wt = a[0];
  const k = watch.buffering ? 0 : (watch.wt - a[0]) / Math.max(1e-6, b[0] - a[0]);
  apply(a, b ?? a, k, dt);
  drawTraffic(watch.wt);
}

/* the recorded traffic (2 frames per game second beside each batch, [t, …(id, type, colour, x, z, yaw, flags) per vehicle]): every vehicle of the frame
   at or before t, interpolated towards the next frame, as the same mesh the driver saw (type + colour pick); gone from the frame = removed. No frames near
   t (a recording from before traffic was recorded, or a gap) = an empty road, as before. */
const TGAP = 1.5;
function drawTraffic(t) {
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

/* write st from two samples – the row layout of client/js/telemetry.js: [t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch, clock?, flags?] */
function apply(a, b, k, dt) {
  const vel0 = st.vel, s0 = st.s, n = k < .5 ? a : b, f = n[13];
  st.t = lerp(a[0], b[0], k); st.s = lerp(a[1], b[1], k); st.d = lerp(a[2], b[2], k); st.psi = lerp(a[3], b[3], k); st.v = Math.max(0, lerp(a[4], b[4], k));
  st.rpm = lerp(a[5], b[5], k); st.gear = n[6]; st.hull = lerp(a[7], b[7], k);
  st.gas = lerp(a[8], b[8], k); st.brake = lerp(a[9], b[9], k); st.steer = st.ste = lerp(a[10], b[10], k); st.clutch = lerp(a[11], b[11], k);
  if (Number.isFinite(f)) {
    st.engineOn = !!(f & FLAGS.engine); st.keyOn = !!(f & FLAGS.key); st.park = !!(f & FLAGS.park); dn.head = !!(f & FLAGS.head); dn.cab = !!(f & FLAGS.cab);
    st.heater = !!(f & FLAGS.heater); st.washing = !!(f & FLAGS.washing); wip.mode = f & FLAGS.wipeFast ? 2 : f & FLAGS.wipeSlow ? 1 : 0; st.rev = !!(f & FLAGS.rev);
  } else { st.engineOn = st.rpm > 300; st.keyOn = st.engineOn; st.park = false; st.rev = st.gear < 0; }   // a recording from before the flag column
  if (Number.isFinite(a[12]) && Number.isFinite(b[12])) dn.t = hourLerp(a[12], b[12], k);
  st.vel = st.rev ? -st.v : st.v; st.ign = null; st.test = 1; st.stalled = false;
  st.off = !net.onRoad(st.s, st.d); net.clock = st.t;   // the signal lights show what the driver saw
  st.complete = st.t >= CFG.RIDE_MIN_SECONDS && st.s >= CFG.COMPLETE_DIST;
  const drop = watch.lastHull - st.hull;
  if (drop > .2 && !watch.jumped) { st.jolt = Math.min(1, st.jolt + .3 + drop / 10); st.crash = Math.min(1, st.crash + drop / 8 + .15); st.flash = Math.min(1, st.flash + drop / 12 + .15); }   // a hit, sized like sim/damage.js hurt(): a scrape flickers, a crash flashes
  watch.lastHull = st.hull;
  if (watch.jumped || Math.abs(st.s - s0) > 60) { st.tyaw = roadAt(st.s).t + st.psi; st.pitch = st.roll = st.pitchV = st.rollV = 0; watch.jumped = false; }
  else if (dt > 0) { trailerYaw(dt); bodySway(dt, vel0); }
}
