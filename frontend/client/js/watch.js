import { setLoadout } from './cosmetics.js';
import { CFG } from './config.js';
import { st, dn } from './state.js';
import { API_BASE } from './hosts.js';
import { roadAt } from './road.js';
import { net } from './net/network.js';
import { roads } from './net/orchestrator.js';
import { FLAGS } from './telemetry.js';
import { phone } from './phone.js';
import { toggleMap } from './ui/map.js';
import { bodySway, trailerYaw } from './sim/physics.js';
import { wip } from './cockpit/windscreen.js';
import { selectTheme } from './world/theme-manager.js';
import { env } from './world/environment.js';
import { THEMES } from './themes/index.js';
import { advanceCursor } from './live-effects.js';
import { visitorId, leaveOnClose } from '../site/presence.js';
import { passedMask, lightInputs, inputLights } from './input-bits.js';
import { replayOver, REPLAY_END_GAP } from './replay-end.js';
import { deepLinkSeconds } from '../site/replay-player.js';
import { addOutcome, roadCheckFrom, stampPassed, placeObstacle, replaceObstacles, drawReplayTraffic } from './watch-world.js';

/* Live streams & replay playback orchestrator (play.html?watch=<rideId>). */
const POLL_LIVE_MS = 4000, POLL_REPLAY_MS = 10_000;
export const LIVE_LAG = 25;                 // s behind the newest recorded second: one ~15 s batch + its upload, with room for jitter
const PREFETCH = 90;                        // s of recording kept loaded ahead of the playhead in a replay
const GAP = REPLAY_END_GAP;                 // s between two samples = a hole in what is loaded (a seek) – hold there until it is fetched
const FORK_COL = 15;                        // the sample's fork road (client/js/telemetry.js)

const viewerId = visitorId;

export const watch = {
  id: null, ride: null, error: '', now: 0, skew: 0,
  features: { chat: true, donations: true, payment: 'mock', effects: true },
  rec: { lastSeq: null, t1: 0 }, finT: null, batches: new Map(), rows: [], tframes: [], cars: new Map(), rowsSeq: -1, events: new Map(), cursor: 0, since: 0, totals: { messages: 0, donations: 0, lamports: 0 }, viewers: 0,
  inputs: inputLights, inT: -1,
  roadSeq: new Map(), road: new Map(), stamp: null, roadT: -1,
  wt: 0, playing: true, speed: 1, follow: true, buffering: false, seeking: false, started: false, jumped: true, lastHull: 100, timer: 0, polling: null, atEnd: false,
  onUpdate: null, onEvent: null,
};
const BATCH = () => CFG.TELEMETRY_BATCH_SECONDS;

export async function initWatch() {
  const id = typeof location === 'undefined' ? null : new URL(location.href).searchParams.get('watch');
  if (!id) return false;
  watch.id = id; st.watch = true;
  leaveOnClose(() => `${API_BASE}/api/watch/${encodeURIComponent(id)}?viewer=${encodeURIComponent(viewerId())}&leave=1`);
  try { await poll(0); } catch (e) { watch.error = e.message; }
  return true;
}

async function get(from) {
  const q = new URLSearchParams({ from: String(from), after: String(watch.cursor), since: String(watch.since), viewer: viewerId() });
  const r = await fetch(`${API_BASE}/api/watch/${encodeURIComponent(watch.id)}?${q}`, { credentials: 'include', signal: AbortSignal.timeout(8000) });
  // A timeout can abort the body after successful headers. Never turn that into an empty snapshot.
  const j = await r.json();
  if (!r.ok) throw new Error(r.status === 404 ? 'this ride does not exist or has not started yet' : j.detail || j.title || `server error ${r.status}`);
  if (!j?.ride || j.ride.id !== watch.id || !j.recording || !Number.isFinite(j.recording.t1) || !(j.recording.lastSeq === null || Number.isInteger(j.recording.lastSeq)) || !Array.isArray(j.batches) || !Array.isArray(j.events) || !Number.isFinite(j.now)) throw new Error('invalid replay response');
  return j;
}

async function poll(from) {
  const j = await get(from);
  watch.error = '';
  const first = !watch.ride;
  watch.ride = j.ride; watch.now = j.now; watch.skew = j.now - Date.now(); watch.rec = j.recording; watch.totals = j.totals; watch.viewers = j.viewers; if (j.features) watch.features = j.features;
  if (first) { CFG.RIDE_MIN_SECONDS = j.ride.minSeconds; CFG.COMPLETE_DIST = j.ride.completeDist; watch.follow = j.ride.live; setLoadout(j.ride.loadout); }
  if (watch.started && j.ride.route && j.ride.route !== env.theme?.id && THEMES.some(t => t.id === j.ride.route)) { selectTheme(j.ride.route, true); replaceObstacles(watch); }
  if (j.batches.length) addBatches(j.batches);
  for (const e of j.events) addEvent(e);
  watch.cursor = advanceCursor(watch.cursor, j.events, j.now);
  watch.since = j.now - 5000;
  watch.onUpdate?.();
  return j;
}

const KEEP_BATCHES = 160, KEEP_AROUND = 600;
const usable = r => Number.isFinite(r[0]);

function addBatches(list) {
  const fresh = list.filter(b => !watch.batches.has(b.seq)).sort((a, b) => a.seq - b.seq);
  if (!fresh.length) return;
  for (const b of fresh) { watch.batches.set(b.seq, b); if (b.road && !watch.roadSeq.has(b.seq)) { watch.roadSeq.set(b.seq, b.road); for (const o of b.road) addOutcome(watch, o); } }
  if (watch.finT === null) for (const b of fresh) { const r = b.samples.find(x => usable(x) && x[1] >= CFG.COMPLETE_DIST); if (r) { watch.finT = r[0]; break; } }
  let pruned = false;
  if (watch.batches.size > KEEP_BATCHES) for (const [seq, b] of watch.batches) if (b.t1 < watch.wt - KEEP_AROUND || b.t0 > watch.wt + PREFETCH + KEEP_AROUND) { watch.batches.delete(seq); pruned = true; }
  if (!pruned && fresh[0].seq === watch.rowsSeq + 1 && fresh.every((b, i) => b.seq === fresh[0].seq + i)) for (const b of fresh) { watch.rows.push(...b.samples.filter(usable)); watch.tframes.push(...(b.traffic ?? []).filter(usable)); }
  else { const all = [...watch.batches.values()].sort((a, b) => a.seq - b.seq); watch.rows = all.flatMap(b => b.samples).filter(usable); watch.tframes = all.flatMap(b => b.traffic ?? []).filter(usable); }
  watch.rowsSeq = Math.max(...watch.batches.keys());
  inputLights.on = false; // public replays do not light the raw input overlay (the input column is zeroed)
}

export const roadCheck = () => roadCheckFrom(watch);

export function addEvent(e) {
  const known = watch.events.get(e.id);
  if (known) { if (!known.applied && e.applied) { known.applied = e.applied; placeObstacle(known); watch.onEvent?.(known, 'applied'); } return; }
  watch.events.set(e.id, e); placeObstacle(e); watch.onEvent?.(e, 'new');
}

export function startWatch() {
  replaceObstacles(watch);
  watch.started = true; watch.jumped = true;
  const deep = typeof location === 'undefined' ? null : deepLinkSeconds(location.search);
  watch.follow = deep == null;
  watch.wt = deep == null ? (watch.follow ? liveTarget() : (watch.rows[0]?.[0] ?? 0)) : deep;
  watch.seeking = true;
  if (deep != null) watch.playing = true;
  schedule(0);
}

const loadedAt = t => { for (const b of watch.batches.values()) if (t >= b.t0 - .05 && t <= b.t1 + .05) return b.seq; return null; };
function wantFrom() {
  const last = watch.rec.lastSeq;
  if (last === null) return 0;
  const here = loadedAt(watch.wt) ?? Math.max(0, Math.min(last, Math.floor(watch.wt / BATCH())));
  for (let s = Math.max(0, here - 1); s <= last; s++) {
    if (watch.batches.has(s)) { if (watch.batches.get(s).t0 > watch.wt + PREFETCH && !watch.follow) return null; continue; }
    return s;
  }
  return last + 1;
}
function schedule(ms) { clearTimeout(watch.timer); watch.timer = setTimeout(tick, ms); }
async function tick() {
  if (!watch.polling) {
    const from = wantFrom() ?? (watch.rec.lastSeq ?? -1) + 1;
    watch.polling = poll(from).catch(e => { watch.error = e.message; watch.onUpdate?.(); }).finally(() => { watch.polling = null; });
    await watch.polling;
  }
  const again = wantFrom(), behind = again !== null && again <= (watch.rec.lastSeq ?? -1);
  schedule(behind ? 50 : watch.ride?.live ? POLL_LIVE_MS : POLL_REPLAY_MS);
}

export const recordedEnd = () => watch.rows.at(-1)?.[0] ?? 0;
const END_PAD = 3;
export const replayEnd = () => (!watch.ride?.live && watch.ride?.status === 'completed' && watch.finT !== null ? Math.min(watch.rec.t1, watch.finT + END_PAD) : watch.rec.t1);
export const liveTarget = () => Math.max(watch.rows[0]?.[0] ?? 0, watch.rec.t1 - LIVE_LAG);
export function seek(t) { watch.follow = false; watch.wt = Math.max(0, Math.min(t, replayEnd())); watch.jumped = true; watch.seeking = true; schedule(0); }
export function goLive() { watch.follow = true; watch.speed = 1; watch.playing = true; watch.wt = liveTarget(); watch.jumped = true; watch.seeking = true; schedule(0); }

function find(t, R = watch.rows) {
  let lo = 0, hi = R.length - 1;
  if (!R.length || t < R[0][0]) return -1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (R[m][0] <= t) lo = m; else hi = m - 1; }
  return lo;
}
const lerp = (a, b, k) => a + (b - a) * k;
const hourLerp = (a, b, k) => { let d = b - a; if (d > 12) d -= 24; else if (d < -12) d += 24; return (a + d * k + 24) % 24; };

function endView(sampleT, nextT) {
  const rows = watch.rows;
  return {
    live: !!watch.ride?.live, status: watch.ride?.status, seeking: !!watch.seeking, rows: rows.length > 0,
    hasLast: watch.rec.lastSeq !== null && watch.batches.has(watch.rec.lastSeq), playing: !!watch.playing, wt: watch.wt, end: replayEnd(),
    lastT: rows.length ? rows[rows.length - 1][0] : 0, lastSeq: watch.rec.lastSeq, sampleT, nextT,
  };
}
function settleEnd(sampleT, nextT) {
  const show = replayOver(endView(sampleT, nextT));
  const stopped = show && watch.playing;
  if (stopped) watch.playing = false;
  const edge = show !== watch.atEnd;
  watch.atEnd = show;
  if (stopped || edge) watch.onUpdate?.();
}

export function stepWatch(dt) {
  if (!watch.started || !watch.rows.length) {
    if (watch.started && (watch.rec.lastSeq === null || watch.batches.has(watch.rec.lastSeq))) watch.seeking = false;
    if (watch.started) settleEnd(0, null);
    return;
  }
  const live = watch.ride?.live && watch.follow;
  const R = watch.rows;
  st.jolt = Math.max(0, st.jolt - dt * 2.5); st.crash = Math.max(0, st.crash - dt * 2.2); st.flash = Math.max(0, st.flash - dt * 1.6); st.rumble = Math.max(0, st.rumble - dt * .7);
  if (watch.seeking) {
    if (live) watch.wt = liveTarget();
    const i = find(watch.wt), a = R[i], b = R[i + 1];
    if (!a || (!b ? watch.wt - a[0] > GAP : b[0] - a[0] > GAP && watch.wt - a[0] > GAP)) { watch.buffering = true; lightInputs(0, dt); settleEnd(a?.[0] ?? watch.wt, b?.[0] ?? null); return; }
    watch.seeking = false;
  }
  if (watch.playing) {
    let rate = watch.speed;
    if (live) { const lag = liveTarget() - watch.wt; if (Math.abs(lag) > 60) { watch.wt = liveTarget(); watch.jumped = true; } else rate = 1 + Math.max(-.3, Math.min(.5, lag / 20)); }
    watch.wt += dt * rate;
    if (!live && watch.wt > replayEnd()) { watch.wt = replayEnd(); if (!watch.ride?.live) watch.playing = false; }
  }
  let i = find(watch.wt);
  if (i < 0) { watch.wt = R[0][0]; i = 0; }
  const a = R[i], b = R[i + 1];
  watch.buffering = !b || b[0] - a[0] > GAP;
  if (watch.buffering) watch.wt = a[0];
  const k = watch.buffering ? 0 : (watch.wt - a[0]) / Math.max(1e-6, b[0] - a[0]);
  lightInputs(watch.buffering ? 0 : inputsPassed(i), dt);
  stampPassed(watch, watch.wt);
  apply(a, b ?? a, k, dt);
  drawReplayTraffic(watch, find, watch.wt);
  settleEnd(a[0], b ? b[0] : null);
}

const inputsPassed = i => { const m = passedMask(watch.rows, i, watch.jumped ? -1 : watch.inT); watch.inT = watch.rows[i][0]; return m; };

function apply(a, b, k, dt) {
  const vel0 = st.vel, s0 = st.s, n = k < .5 ? a : b, f = n[13];
  const fa = Number.isFinite(a[FORK_COL]) ? net.forkAt(a[1]) : null, kp = fa && fa === net.forkAt(b[1]) && a[FORK_COL] !== b[FORK_COL] ? (k < .5 ? 0 : 1) : k;
  st.t = lerp(a[0], b[0], k); st.s = lerp(a[1], b[1], kp); st.d = lerp(a[2], b[2], kp); st.psi = lerp(a[3], b[3], kp); st.v = Math.max(0, lerp(a[4], b[4], k));
  const fk = net.forkAt(st.s), fs = fk && [n, n === a ? b : a].find(x => Number.isFinite(x[FORK_COL]) && net.forkAt(x[1]) === fk);
  if (fs) roads.setBranch(st.s, fs[FORK_COL]);
  st.rpm = lerp(a[5], b[5], k); st.gear = n[6]; st.hull = lerp(a[7], b[7], k);
  st.gas = lerp(a[8], b[8], k); st.brake = lerp(a[9], b[9], k); st.steer = st.ste = lerp(a[10], b[10], k); st.clutch = lerp(a[11], b[11], k);
  if (Number.isFinite(f)) {
    st.engineOn = !!(f & FLAGS.engine); st.keyOn = !!(f & FLAGS.key); st.park = !!(f & FLAGS.park); dn.head = !!(f & FLAGS.head); dn.cab = !!(f & FLAGS.cab);
    st.heater = !!(f & FLAGS.heater); st.cooler = !!(f & FLAGS.cooler); st.washing = !!(f & FLAGS.washing); wip.mode = f & FLAGS.wipeFast ? 2 : f & FLAGS.wipeSlow ? 1 : 0; st.rev = !!(f & FLAGS.rev);
    if (!!(f & FLAGS.phone) !== phone.open && (watch.jumped || !!(f & FLAGS.phone) !== watch.phoneRec)) toggleMap(!!(f & FLAGS.phone));
    watch.phoneRec = !!(f & FLAGS.phone);
    st.heatEff = st.heater && (st.engineOn || st.keyOn) ? 1 : 0; st.coolEff = st.cooler && st.engineOn ? 1 : 0;
  } else { st.engineOn = st.rpm > 300; st.keyOn = st.engineOn; st.park = false; st.rev = st.gear < 0; }
  if (Number.isFinite(a[12]) && Number.isFinite(b[12])) dn.t = hourLerp(a[12], b[12], k);
  st.vel = st.rev ? -st.v : st.v; st.ign = null; st.test = 1; st.stalled = false;
  st.off = !net.onRoad(st.s, st.d); net.clock = st.t;
  st.complete = st.s >= CFG.COMPLETE_DIST;
  const drop = watch.lastHull - st.hull;
  if (drop > .2 && !watch.jumped) { st.jolt = Math.min(1, st.jolt + .3 + drop / 10); st.crash = Math.min(1, st.crash + drop / 8 + .15); st.flash = Math.min(1, st.flash + drop / 12 + .15); }
  watch.lastHull = st.hull;
  if (watch.jumped || Math.abs(st.s - s0) > 60) { st.tyaw = roadAt(st.s).t + st.psi; st.pitch = st.roll = st.pitchV = st.rollV = 0; watch.jumped = false; }
  else if (dt > 0) { trailerYaw(dt); bodySway(dt, vel0); }
}
