#!/usr/bin/env node
// Trip design – measure what each trip (client/js/trips.js) does to a ride, with the REAL game modules in Node (stubbed three.js + a fake DOM, like
// client/tools/headless-test.mjs). Two parts:
//   ROAD   per trip × route, over --km of road on --seeds seeds: how far the road runs straight from the depot (until it first bends tighter than R 1 km –
//          the depot's right turn counts, a straight start does not), the sharpest bend (min radius), the share of road tighter than 150 m, mean |curvature|;
//          plus junctions / signals / sinkholes per km – those are the SEED's (the server's layout), the same for every trip, shown for context.
//   DRIVE  a scripted driver (lane keeping, slows for bends and for the car ahead, upshifts at 2300 rpm, ignores the holes) does a whole shift of
//          --seconds / COMPLETE_DIST_K × 28 × seconds metres from the depot: game seconds until COMPLETE, hull lost, vehicle / building contacts, off-road
//          seconds, how it ended (and why). It stops for red lights and the car ahead but ignores the sinkholes, and it drives with the headless test's pre-weight handling (it pops the clutch and steers in bangs), so its times are those
//          of a driver who knows the cab – a first-timer takes longer. Compare trips with it; don't quote it as a player's time.
// Usage (repo root):  node .claude/skills/trip-design/measure.mjs [--trips free,1h,4h,8h] [--routes route66,brenner|all] [--seeds 5] [--km 6]
//                     [--seconds S] [--k K]   (default: each trip's own shift – trips.js seconds / k, else 60 s and COMPLETE_DIST_K) [--drive-route route66] [--no-drive] [--no-road]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), CLIENT = join(ROOT, 'client');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const flag = k => process.argv.includes('--' + k);
const SEEDS = +arg('seeds', 5), KM = +arg('km', 6), SECONDS = arg('seconds', null), K = arg('k', null), DRIVE_ROUTE = arg('drive-route', 'route66');

// ── the game, bundled with stubbed three.js ──
const out = join(tmpdir(), 'freightchain-trip'); mkdirSync(out, { recursive: true });
const bundle = join(out, 'fc-trip.js');
execFileSync('npx', ['esbuild', 'js/main.js', '--bundle', '--format=esm', '--alias:three=./tools/stub-three.mjs', `--outfile=${bundle}`, '--log-level=error'], { cwd: CLIENT, stdio: 'inherit' });

// ── fake browser (the headless test's) ──
let seed = 12345; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
let now = 1000; Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
const listeners = {}, store = {};
const ctxStub = new Proxy(function () {}, { get: (_, p) => p === 'createLinearGradient' || p === 'createRadialGradient' ? () => ({ addColorStop() {} }) : p === 'measureText' ? () => ({ width: 10 }) : () => {}, set: () => true });
class El { onclick = null; constructor(id) { this.id = id; this.style = {}; this.classList = { add() {}, remove() {}, toggle() {} }; this.textContent = ''; this.innerHTML = ''; } getContext() { return ctxStub; } click() { this.onclick && this.onclick(); } querySelectorAll() { return []; } querySelector() { return new El('q'); } addEventListener() {} appendChild() {} remove() {} }
const els = {}; globalThis.document = { getElementById: id => els[id] ??= new El(id), createElement: () => new El('x'), addEventListener: (k, f) => (listeners['doc:' + k] ??= []).push(f), body: { style: {}, appendChild() {} }, querySelectorAll: () => [], hidden: false }; globalThis.matchMedia = () => ({ matches: true });
globalThis.window = globalThis; globalThis.addEventListener = (k, f) => (listeners[k] ??= []).push(f);
globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1; globalThis.AudioContext = undefined;
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
let rafCb = null; globalThis.requestAnimationFrame = f => { rafCb = f; };
globalThis.setTimeout = () => 0;   // the end-of-ride stamp's cleanup timer: nothing to clean in a fake DOM, and it must not keep Node alive
await import(pathToFileURL(bundle).href);
const G = globalThis.__game, { st, input, net, CFG } = G;
const fire = (type, code) => (listeners[type] || []).forEach(f => f({ code, repeat: false, preventDefault() {} }));
const step = (n = 1) => { for (let i = 0; i < n; i++) { now += 1000 / 60; const cb = rafCb; rafCb = null; cb(now); } };
const TRIP_IDS = Object.keys(await import(pathToFileURL(join(CLIENT, 'js/trips.js')).href).then(m => m.TRIPS));
const trips = arg('trips', TRIP_IDS.join(',')).split(',');
const routesArg = arg('routes', 'all'), routes = routesArg === 'all' ? G.THEMES.map(t => t.id) : routesArg.split(',');
for (const id of [...trips]) if (!TRIP_IDS.includes(id)) { console.error(`unknown trip ${id} (have ${TRIP_IDS.join(', ')})`); process.exit(2); }
const pad = (v, n) => String(v).padStart(n), f1 = v => v.toFixed(1);

// ── ROAD ──
if (!flag('no-road')) {
  console.log(`\nROAD  first ${KM} km of the main road · ${SEEDS} seeds · radius = 1 / |curvature|`);
  console.log('trip  route        straight m  min R m  <150 m %  mean|k|·1e3   junct/km  signals/km  holes/km');
  for (const id of trips) for (const rid of routes) {
    G.setTrip(id); G.selectTheme(rid, false);
    let kMax = 0, tight = 0, n = 0, kSum = 0, js = 0, sig = 0, holes = 0, flat = 0;
    for (let sd = 1; sd <= SEEDS; sd++) {
      G.roads.newTrip(sd * 7919);
      let f = 0; while (f < 5000 && Math.abs(net.curv(f)) < 1 / 1000) f += 5; flat += f;   // from the depot until the road first bends tighter than R 1 km (the depot turn counts)
      const a = net.Sm, b = net.Sm + KM * 1000;
      for (let s = a; s < b; s += 5) { const k = Math.abs(net.curv(s)); kMax = Math.max(kMax, k); kSum += k; n++; if (k > 1 / 150) tight++; }
      const jj = net.near(a, b).filter(j => j.kind !== 'start'); js += jj.length; sig += jj.filter(j => j.signal).length;
      holes += G.holes.holesNear(a, b).length;
    }
    const per = v => f1(v / SEEDS / KM);
    console.log(`${id.padEnd(5)} ${rid.padEnd(12)} ${pad(Math.round(flat / SEEDS), 10)}  ${pad(kMax ? Math.round(1 / kMax) : '∞', 7)}  ${pad(f1(100 * tight / n), 8)}  ${pad((1e3 * kSum / n).toFixed(2), 11)}   ${pad(per(js), 8)}  ${pad(per(sig), 10)}  ${pad(per(holes), 8)}`);
  }
}

// ── DRIVE ──
function curveSpeed() {   // the speed a careful driver takes the next 150 m at (lateral ~2.2 m/s²)
  let k = 0; for (let s = st.s; s < st.s + 150; s += 10) k = Math.max(k, Math.abs(net.curv(s)));
  return k > 1e-5 ? Math.sqrt(2.2 / k) : 99;
}
function signalSpeed() {   // stop for a red / amber main-road light: brake to the stop line
  const j = net.nextJunction(st.s, 1, 150, q => q.signal); if (!j) return 99;
  const gap = j.s - (j.mouth + 2) - 3 - st.s, light = net.signal(j, 'main');
  return gap > 0 && light !== 'G' && (light === 'R' || gap > st.v * 1.2) ? Math.sqrt(2 * 3 * Math.max(0, gap - 2)) : 99;
}
function followSpeed() {   // the car ahead in my lane
  let v = 99;
  for (const a of G.traffic) if (a.road.main && a.dir > 0 && Math.abs(a.lat - st.d) < 2.6) { const gap = a.s - st.s; if (gap > 0 && gap < 25 + st.v * 2.5) v = Math.min(v, gap < 18 ? 0 : a.v - 1); }
  return v;
}
const launch = () => {   // clutch in, start the engine if it died, 1st gear, gas, ease out
  input.gas = 0; input.brake = 0; fire('keydown', 'ShiftLeft'); step(20);
  if (!st.engineOn) { fire('keydown', 'KeyI'); step(60 * 2.6); }
  fire('keydown', 'Digit1'); step(25); input.gas = 1; step(10); fire('keyup', 'ShiftLeft'); step(40);
};
const shift = up => { fire('keydown', 'ShiftLeft'); step(20); fire('keydown', up ? 'KeyE' : 'KeyQ'); step(6); fire('keyup', 'ShiftLeft'); };
function rideOnce(sd, secs) {
  G.st.mode = 'done'; G.roads.seed = sd; G.startRide();
  G.roads.newTrip(sd); G.st.mode = 'drive';   // the same road for every trip: a fixed seed (startRide rolled a random one)
  st.park = false; st.temp = CFG.ENGINE_WARM + 5; step(30); fire('keydown', 'KeyI'); step(60 * 2.6);
  shift(true);
  let offT = 0;
  for (let i = 0; i < (secs * 3 + 120) * 10 && st.mode === 'drive' && !st.complete; i++) {   // give up at 3× the shift (+2 min): 'timeout'
    const e = (st.d - 2.4) + 10 * st.psi; input.left = e > .5 ? 1 : 0; input.right = e < -.5 ? 1 : 0;
    let vmax = st.s < 30 ? 4 : net.straight ? Math.min(26, curveSpeed()) : st.s < net.sA - 40 ? 11 : st.s < net.Sm + 25 ? 5 : Math.min(26, curveSpeed());   // a straight start (trips.js `start`): no turn to slow for
    vmax = Math.min(vmax, followSpeed(), signalSpeed());
    input.gas = st.v < vmax ? 1 : 0; input.brake = st.v > vmax + 1.5 ? 1 : 0;
    if ((!st.engineOn && !st.ign) || (st.v < 1.5 && st.gear > 1)) { launch(); continue; }   // stalled, or stopped in a tall gear: clutch in, (restart,) 1st, pull away
    if (st.s > 30 && st.gear === 1 && st.rpm > 1800) shift(true);
    else if (st.gear > 1 && st.gear < 7 && st.rpm > 2300 && input.gas) shift(true);
    else if (st.gear > 2 && st.rpm < 1000) shift(false);
    step(6); if (st.off) offT += .1;
  }
  input.gas = input.brake = input.left = input.right = 0;
  const why = /Reason<\/span><span class="bad">([^<]*)/.exec(document.getElementById('panel').innerHTML)?.[1];
  return { why, t: st.t, s: st.s, hull: 100 - st.hull, crashV: st.crashV, crashB: st.crashB, offT, end: st.complete ? 'complete' : st.mode === 'done' ? 'failed' : 'timeout' };
}
if (!flag('no-drive')) {
  const T0 = { ...CFG.TRUCK }; Object.assign(CFG.TRUCK, { MASS: 1, BRAKE: 9, STEER_RATE: 1.8, STEER_RETURN: 3.5, YAW_LAG: 0, CENTRIF: .03 });   // the scripted driver's handling (see the header)
  const K0 = CFG.COMPLETE_DIST_K; CFG.FARE = 0;
  G.selectTheme(DRIVE_ROUTE, false);
  console.log(`\nDRIVE  ${DRIVE_ROUTE} · ${SEEDS} seeds · each trip's own shift (the free run's 60 s / k 0.25; ${SECONDS ?? 60} s / k ${K ?? K0} otherwise – --seconds / --k override every trip) · scripted driver (an experienced one – see the header)`);
  console.log('trip  shift          done   median t s  max t s   median m   hull lost %  vehicle hits  building hits  off-road s');
  for (const id of trips) {
    const T = G.setTrip(id), secs = +(SECONDS ?? T.seconds ?? 60), k = +(K ?? T.k ?? K0), rs = [];
    CFG.RIDE_MIN_SECONDS = secs; CFG.COMPLETE_DIST = k * CFG.MAX_SPEED * secs;
    for (let sd = 1; sd <= SEEDS; sd++) rs.push(rideOnce(sd * 7919, secs));
    const ok = rs.filter(r => r.end === 'complete'), ts = ok.map(r => r.t).sort((a, b) => a - b), ss = rs.map(r => r.s).sort((a, b) => a - b), avg = k => rs.reduce((a, r) => a + r[k], 0) / rs.length;
    console.log(`${id.padEnd(5)} ${(secs + ' s ' + Math.round(CFG.COMPLETE_DIST) + ' m').padEnd(14)} ${pad(ok.length + '/' + rs.length, 4)}   ${pad(ts.length ? f1(ts[ts.length >> 1]) : '–', 10)}  ${pad(ts.length ? f1(ts.at(-1)) : '–', 7)}   ${pad(Math.round(ss[ss.length >> 1]), 8)}   ${pad(f1(avg('hull')), 11)}  ${pad(f1(avg('crashV')), 12)}  ${pad(f1(avg('crashB')), 13)}  ${pad(f1(avg('offT')), 10)}`);
    for (const r of rs.filter(r => r.end !== 'complete')) console.log(`      ${r.end} at ${f1(r.t)} s, ${Math.round(r.s)} m${r.why ? ' – ' + r.why : ''}`);
  }
  Object.assign(CFG.TRUCK, T0);
}
console.log('');
process.exit(0);
