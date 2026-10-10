#!/usr/bin/env node
// Level check – is every FREE LEVEL (client/js/trips.js free-1 / free-2 / free-3: EASY / CROSSROADS / HARD) passable by a human, and does each one mean
// what its name says? Runs the REAL game modules in Node (stubbed three.js + a fake DOM, like client/tools/headless-test.mjs) on many seeds × routes:
//   ROAD   the road a level's shift covers (its finish line + 40 %): junctions, forks, lanes, the sharpest bend, sinkholes – and for every sinkhole whether a
//          driver who reacts to its warning sign HOLE_WARN m ahead can still stop or steer round it at the speed the road allows there.
//   DRIVE  a HUMAN-paced driver (reacts after --react s, takes bends at 80 % of the grip, keeps a gap, stops for red, sees a sinkhole only at its sign and
//          then changes lane / swerves into a free oncoming lane / slows to a crawl, takes the OTHER road at every second fork) drives the whole shift on
//          the REAL truck handling (CFG.TRUCK as shipped – unlike trip-design's measure.mjs) with ASSIST OFF: does it finish, how much hull, crashes,
//          off-road, how long.
//   VERDICT per level, against LIMITS below (the level's promise). Exit 1 if a level fails one – a road change that makes EASY need skill, or HARD impossible,
//          fails here.
// Usage (repo root): node .claude/skills/level-check/check.mjs [--levels free-1,free-2,free-3] [--routes all|route66,siberia] [--seeds 6] [--react 1.0]
//                    [--no-drive] [--no-road] [--care .8] [--verbose] [--only route66:39608 – one drive, with TRACE=1 a line per second]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), CLIENT = join(ROOT, 'client');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const flag = k => process.argv.includes('--' + k);
const ONLY = arg('only', null), SEEDS = +arg('seeds', 6), REACT = +arg('react', 1.0), VERBOSE = flag('verbose');

/* What each level promises. `road` is checked on every seed × route, `drive` over all of them.
   EASY: a first-timer's minute – no junction, no fork, no sinkhole, four lanes, gentle bends; every drive finishes almost unscratched.
   CROSSROADS: junctions and a fork really come up in its 3 minutes; still forgiving – nearly every drive finishes.
   HARD: everything, ten minutes, no assist – most careful drives still finish; a sinkhole is never a trap (always a way round or time to stop). */
const LIMITS = {
  'free-1': { name: 'EASY', road: { junctionsMax: 0, forksMax: 0, holesMax: 0, lanesMin: 2, radiusMin: 220 }, drive: { finishMin: 1, hullLostMax: 10, crashesMax: 0 } },
  'free-2': { name: 'CROSSROADS', road: { junctionsMin: 1, forksMin: 1, radiusMin: 120, trapsMax: 0 }, drive: { finishMin: .9, hullLostMax: 35, crashesMax: 0 } },
  'free-3': { name: 'HARD', road: { junctionsMin: 2, forksMin: 1, radiusMin: 60, trapsMax: 0 }, drive: { finishMin: .75, hullLostMax: 60, crashesMax: 1 } },
};
const levels = arg('levels', Object.keys(LIMITS).join(',')).split(',');

// ── the game, bundled with stubbed three.js, in the headless test's fake browser ──
const out = join(tmpdir(), 'freightchain-level-check'); mkdirSync(out, { recursive: true });
const bundle = join(out, 'fc-level.js');
execFileSync('npx', ['esbuild', 'js/main.js', '--bundle', '--format=esm', '--alias:three=./tools/stub-three.mjs', `--outfile=${bundle}`, '--log-level=error'], { cwd: CLIENT, stdio: 'inherit' });
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
globalThis.setTimeout = () => 0;
await import(pathToFileURL(bundle).href);
const G = globalThis.__game, { st, input, net, CFG } = G, TRIPS = (await import(pathToFileURL(join(CLIENT, 'js/trips.js')).href)).TRIPS;
const fire = (type, code) => (listeners[type] || []).forEach(f => f({ code, repeat: false, preventDefault() {}, timeStamp: now }));
const step = (n = 1) => { for (let i = 0; i < n; i++) { now += 1000 / 60; const cb = rafCb; rafCb = null; cb(now); } };
const routesArg = arg('routes', 'all'), routes = routesArg === 'all' ? G.THEMES.map(t => t.id) : routesArg.split(',');
for (const id of levels) if (!LIMITS[id] || !TRIPS[id]) { console.error(`unknown level ${id} (have ${Object.keys(LIMITS).join(', ')})`); process.exit(2); }
const GRIP = 2.2 * +(arg('care', .8));   // the lateral m/s² the driver takes bends at (2.2 = trip-design's experienced driver; --care scales it)
const pad = (v, n) => String(v).padStart(n), f1 = v => v.toFixed(1), F = G.forkRules, BRAKE = CFG.TRUCK.BRAKE, CRAWL = 3;
const shiftOf = id => { const T = TRIPS[id]; return { secs: T.seconds, dist: T.k * CFG.MAX_SPEED * T.seconds }; };   // offline = the server's lengths at FREE_RIDE_SECONDS 60 (ride-trip.ts FREE_LEVELS)
const curveSpeedAt = (s, span = 150, grip = 2.2) => { let k = 0; for (let x = s; x < s + span; x += 10) k = Math.max(k, Math.abs(net.curv(x))); return Math.min(26, k > 1e-5 ? Math.sqrt(grip / k) : 99); };

// ── ROAD ──
const fails = [];
function roadOf(id, rid, sd) {
  G.setTrip(id); G.selectTheme(rid, false); G.roads.newTrip(sd);
  const { dist } = shiftOf(id), reach = dist * 1.4 + 200, a = net.Sm, b = reach;
  net.ensure(b + 500);
  let kMax = 0; for (let s = a; s < b; s += 5) kMax = Math.max(kMax, Math.abs(net.curv(s)));
  const junctions = net.near(0, b).filter(j => j.kind !== 'start'), forks = net.forksNear(0, b).filter(f => f.f0 < b);
  let lanesMin = 9; for (let s = a + 130; s < b; s += 20) lanesMin = Math.min(lanesMin, net.lanes(s, 1));
  const holes = G.holes.holesNear(0, b), traps = [], tight = [];
  for (const h of holes) {   // seen at its sign (HOLE_WARN m) + the reaction: can the driver stop before it (to a crawl), or is there room to steer round it?
    if (h.l1 < 1.1) continue;   // not in my lane (the oncoming one): nothing to do
    const v = curveSpeedAt(h.s - CFG.HOLE_WARN - 60, 120), need = v * REACT + Math.max(0, v * v - CRAWL * CRAWL) / (2 * BRAKE);   // full pedal after the reaction
    if (net.lanes(h.s, 1) > 1) continue;   // a second lane of my own: steer round it
    if (need > CFG.HOLE_WARN) traps.push(`${h.type} at ${Math.round(h.s)} m: ${Math.round(need)} m to stop from ${f1(v)} m/s, its sign ${CFG.HOLE_WARN} m before it, one lane – only a free oncoming lane gets round it`);
    else if (CFG.HOLE_WARN - need < 15) tight.push(`${h.type} at ${Math.round(h.s)} m: stops ${Math.round(CFG.HOLE_WARN - need)} m short at full pedal from ${f1(v)} m/s`);
  }
  return { junctions: junctions.length, signals: junctions.filter(j => j.signal).length, forks: forks.length, lanesMin, radius: kMax ? Math.round(1 / kMax) : Infinity, holes: holes.length, traps, tight };
}
if (!flag('no-road')) console.log(`\nROAD  each level's reach (its finish line × 1.4 + 200 m) · ${SEEDS} seeds × ${routes.length} routes · reaction ${REACT} s · stopping at full pedal ${BRAKE} m/s²`);
if (!flag('no-road')) console.log('level        route        junctions  signals  forks  min lanes  min R m  sinkholes  traps  tight');
if (!flag('no-road')) for (const id of levels) {
  const L = LIMITS[id].road, agg = { junctions: [], forks: [], holes: [], radius: [], lanes: [], traps: 0 };
  for (const rid of routes) {
    const rs = []; for (let k = 1; k <= SEEDS; k++) rs.push(roadOf(id, rid, k * 7919 + 13));
    for (const r of rs) {
      agg.junctions.push(r.junctions); agg.forks.push(r.forks); agg.holes.push(r.holes); agg.radius.push(r.radius); agg.lanes.push(r.lanesMin); agg.traps += r.traps.length;
      const bad = [];
      if (L.junctionsMax !== undefined && r.junctions > L.junctionsMax) bad.push(`${r.junctions} junctions`);
      if (L.junctionsMin !== undefined && r.junctions < L.junctionsMin) bad.push(`only ${r.junctions} junctions`);
      if (L.forksMax !== undefined && r.forks > L.forksMax) bad.push(`${r.forks} forks`);
      if (L.forksMin !== undefined && r.forks < L.forksMin) bad.push(`no fork`);
      if (L.holesMax !== undefined && r.holes > L.holesMax) bad.push(`${r.holes} sinkholes`);
      if (L.lanesMin !== undefined && r.lanesMin < L.lanesMin) bad.push(`${r.lanesMin} lane(s)`);
      if (r.radius < L.radiusMin) bad.push(`a ${r.radius} m bend`);
      if (L.trapsMax !== undefined && r.traps.length > L.trapsMax) bad.push(...r.traps);
      if (bad.length) fails.push(`${id} ROAD ${rid}: ${bad.join('; ')}`);
    }
    const mm = k => { const v = rs.map(r => r[k]); return `${Math.min(...v)}–${Math.max(...v)}`; };
    console.log(`${(id + ' ' + LIMITS[id].name).padEnd(12)} ${rid.padEnd(12)} ${pad(mm('junctions'), 9)}  ${pad(mm('signals'), 7)}  ${pad(mm('forks'), 5)}  ${pad(mm('lanesMin'), 9)}  ${pad(Math.min(...rs.map(r => r.radius)), 7)}  ${pad(mm('holes'), 9)}  ${pad(rs.reduce((a, r) => a + r.traps.length, 0), 5)}  ${pad(rs.reduce((a, r) => a + r.tight.length, 0), 5)}`);
    if (VERBOSE) for (const r of rs) { for (const t of r.traps) console.log('      trap: ' + t); for (const t of r.tight) console.log('      tight: ' + t); }
  }
}

// ── DRIVE ──
/* a human-paced driver: everything it sees it acts on REACT s later; it never knows the road beyond what is in front of the windscreen */
function makeDriver(takeOther) {
  const seen = new Map();   // event key → game time first seen (the reaction clock)
  let stopped = false;
  const after = (key, delay = REACT) => { if (!seen.has(key)) seen.set(key, st.t); return st.t - seen.get(key) >= delay; };
  return function plan() {
    let vmax = st.s < 30 ? 4 : net.straight ? curveSpeedAt(st.s, 150, GRIP) : st.s < net.sA - 40 ? 10 : st.s < net.Sm + 25 ? 3 : curveSpeedAt(st.s, 150, GRIP);
    if (!net.straight && st.s < net.sA) {   // the depot exit: stop at the STOP line, turn out only into a gap in the main road's traffic (both ways pass the exit)
      const line = net.sA - 4, busy = G.traffic.some(a => a.road.main && (a.dir > 0 ? a.s > net.Sm - 30 - Math.abs(a.v) * 14 && a.s < net.Sm + 40 : a.s > net.Sm - 30 && a.s < net.Sm + 30 + Math.abs(a.v) * 8));   // a slow truck turning out needs ~12 s: room behind it in its new lane, and the oncoming side clear of the mouth
      if (st.s < line) vmax = Math.min(vmax, Math.sqrt(2 * 2.5 * Math.max(0, line - st.s)));
      if (st.s >= line - 1.5) {
        if (!stopped) { vmax = 0; if (st.v < .3 && after('stop-line', REACT + 1)) stopped = true; }   // a full stop, a look both ways…
        else vmax = busy ? 0 : 3;   // …and out into a gap
      }
    }
    let dT = 2.4;
    // a fork: every second one, the OTHER road (aim at its right-hand lane while the two are still one apron)
    const f = net.forkAt(st.s);
    if (takeOther && f && st.s > f.f0 + 40 && st.s < f.f0 + F.commit + 10 && f.choice === 0) {
      const left = net.bulge(f) > 0;   // the other road branches off to the LEFT: getting there crosses the oncoming lane – give way to it, like a left turn
      const clear = !left || !G.traffic.some(a => a.road.main && a.dir < 0 && a.s > st.s - 10 && a.s < st.s + 40 + Math.abs(a.v) * 5);
      if (clear && after('fork-gap' + f.i, REACT * .5)) dT = -net.bulge(f) * net.sep(st.s + 15) + 2.4;
      else if (left) seen.delete('fork-gap' + f.i);   // not clear (any more): look again
    }
    // red / amber lights (seen 150 m ahead)
    const j = net.nextJunction(st.s, 1, 150, q => q.signal);
    if (j) { const gap = j.s - (j.mouth + 2) - 3 - st.s, light = net.signal(j, 'main'); if (gap > 0 && light !== 'G' && (light === 'R' || gap > st.v * 1.2) && after('light' + j.id, REACT * .6)) vmax = Math.min(vmax, Math.sqrt(2 * 3 * Math.max(0, gap - 2))); }
    // the car ahead in my lane
    for (const a of G.traffic) if (a.road.main && a.dir > 0 && Math.abs(a.lat - st.d) < 2.6) { const gap = a.s - st.s; if (gap > 0 && gap < 25 + st.v * 2.5 && after('car' + a.id, REACT * .5)) vmax = Math.min(vmax, gap < 18 ? 0 : a.v - 1); }
    // sinkholes: seen at their sign (HOLE_WARN m), acted on REACT s later – another lane of mine, else a free oncoming lane, else a crawl
    for (const h of G.holes.holesNear(st.s, st.s + CFG.HOLE_WARN)) {
      if (h.s < st.s - 14 || !after('hole' + h.id)) continue;
      const myTrack = [dT - 1.4, dT + 1.4]; if (h.l1 < myTrack[0] - .3 || h.l0 > myTrack[1] + .3) continue;
      const lanes = net.lanes(h.s, 1), other = lanes > 1 ? (h.lat > 4.5 ? 2.4 : 2.4 + 4.2) : null;
      const oncomingFree = !G.traffic.some(a => a.road.main && a.dir < 0 && a.s > st.s - 20 && a.s < h.s + 250);
      if (other !== null) dT = other;
      else if (h.l0 > 0 && oncomingFree && h.s - st.s < 60) { dT = -2.4; vmax = Math.min(vmax, 12); }
      else vmax = Math.min(vmax, h.s - st.s > 25 ? Math.max(CRAWL, Math.sqrt(2 * BRAKE * .6 * (h.s - st.s - 20))) : CRAWL - .5);
    }
    return { vmax, dT };
  };
}
/* where to hold the wheel to reach lateral position dT: aim the heading at a point ~3 s ahead (no more than 2 / v rad – a lane change at speed is gentle),
   then the wheel that turns the truck onto that heading over ~1.4 s on top of what the road's own bend needs (the game: psi' = v·(ste·gain) − k·v, gain = steerGain() in sim/physics.js) */
function wheelFor(dT) {
  const T = CFG.TRUCK, v = Math.max(st.v, 1), gain = T.STEER_GAIN + ((T.STEER_GAIN_LOW ?? T.STEER_GAIN) - T.STEER_GAIN) * Math.max(0, Math.min(1, 1 - st.v / (T.STEER_LOW_V || 1)));
  const look = Math.max(12, 3 * v), cap = Math.min(.3, 2 / v), psiDes = Math.max(-cap, Math.min(cap, -(st.d - dT) / look)), k = net.curv(st.s + v * .6);
  return Math.max(-1, Math.min(1, (k + (psiDes - st.psi) / Math.max(7, 1.4 * v)) / gain));
}
const launch = () => {
  input.gas = 0; input.brake = 0; fire('keydown', 'ShiftLeft'); step(20);
  if (!st.engineOn) { fire('keydown', 'KeyI'); step(60 * 2.6); }
  fire('keydown', 'Digit1'); step(25); input.gas = .6; step(10); fire('keyup', 'ShiftLeft'); step(40);
};
const shift = up => { fire('keydown', 'ShiftLeft'); step(20); fire('keydown', up ? 'KeyE' : 'KeyQ'); step(6); fire('keyup', 'ShiftLeft'); };
function driveOnce(id, rid, sd, takeOther) {
  seed = sd; now = 1000;   // every drive replays alike whatever ran before it (--only reproduces it)
  G.setTrip(id); G.selectTheme(rid, false); G.setGuide({});   // ASSIST OFF: the hardest case for EASY / CROSSROADS, the only case for HARD
  const { secs, dist } = shiftOf(id); CFG.RIDE_MIN_SECONDS = secs; CFG.COMPLETE_DIST = dist;
  st.mode = 'done'; G.startRide(); G.roads.newTrip(sd); st.mode = 'drive';
  st.park = false; st.temp = CFG.ENGINE_WARM + 5; step(30); fire('keydown', 'KeyI'); step(60 * 2.6);
  const plan = makeDriver(takeOther); let offT = 0, other = 0, forks = new Set();
  for (let i = 0; i < (secs * 3 + 120) * 10 && st.mode === 'drive' && !st.complete; i++) {
    const p = plan(), want = wheelFor(p.dT);   // a human turns the wheel to a position and holds it – not a bang-bang on the keys
    input.left = st.steer > want + .04 ? 1 : 0; input.right = st.steer < want - .04 ? 1 : 0;
    input.gas = st.v < p.vmax ? 1 : 0; input.brake = st.v > p.vmax + 1 ? 1 : 0;
    if ((!st.engineOn && !st.ign) || st.gear === 0 || (st.v < 1.5 && st.gear > 1)) { if (p.vmax > 1) launch(); else { input.gas = 0; input.brake = 1; step(6); } continue; }   // stalled, in neutral, or stopped in a tall gear: clutch in, (restart,) 1st, pull away – unless it is waiting
    if (st.s > 30 && st.gear === 1 && st.rpm > 1800) shift(true);
    else if (st.gear > 1 && st.gear < 7 && st.rpm > 2200 && input.gas) shift(true);
    else if (st.gear > 2 && st.rpm < 1050) shift(false);
    step(6); if (st.off) offT += .1;
    if (process.env.TRACE && (i % 10 === 0 || process.env.TRACE === '2')) console.log('near', JSON.stringify(G.traffic.filter(a => a.road.main && Math.abs(a.s - st.s) < 80).map(a => [a.def?.name ?? '', a.dir, Math.round(a.s - st.s), +a.lat.toFixed(1), +a.v.toFixed(1), a.preset?.name ?? a.P?.name ?? ''])), 'fork', !!net.forkAt(st.s), 'holes', JSON.stringify(G.holes.holesNear(st.s, st.s + 120).map(h => [Math.round(h.s - st.s), +h.lat.toFixed(1)])));
    if (process.env.TRACE && i % 10 === 0) console.log('t', f1(st.t), 's', Math.round(st.s), 'd', f1(st.d), 'psi', st.psi.toFixed(3), 'v', f1(st.v), 'g', st.gear, 'steer', st.steer.toFixed(2), 'off', st.off);
    const f = net.forkAt(st.s); if (f && st.s > f.f0 + F.commit) { forks.add(f.i); if (f.choice) other++; }
  }
  input.gas = input.brake = input.left = input.right = 0;
  const why = /Reason<\/span><span class="bad">([^<]*)/.exec(document.getElementById('panel').innerHTML)?.[1];
  return { rid, sd, t: st.t, s: st.s, hullLost: 100 - st.hull, crashes: st.crashV + st.crashB, crashV: st.crashV, crashB: st.crashB, offT, otherRoad: other > 0, forks: forks.size, end: st.complete ? 'complete' : st.mode === 'done' ? 'failed' : 'timeout', why };
}
if (!flag('no-drive')) {
  console.log(`\nDRIVE  a human-paced driver on the shipped truck handling, ASSIST off, reaction ${REACT} s · ${SEEDS} seeds × ${routes.length} routes · every second ride takes the other road at each fork`);
  console.log('level          shift            finished  median t s  max t s  hull lost % (median / max)  vehicles hit (median)  off-road s  other road taken');
  for (const id of levels) {
    const L = LIMITS[id].drive, { secs, dist } = shiftOf(id), rs = [];
    for (const rid of routes) for (let k = 1; k <= SEEDS; k++) if (!ONLY || ONLY === `${rid}:${k * 7919 + 13}`) rs.push(driveOnce(id, rid, k * 7919 + 13, k % 2 === 0));
    const ok = rs.filter(r => r.end === 'complete'), ts = ok.map(r => r.t).sort((a, b) => a - b), hl = rs.map(r => r.hullLost).sort((a, b) => a - b);
    const med = a => a.length ? a[a.length >> 1] : NaN, crashes = med(rs.map(r => r.crashV).sort((a, b) => a - b)), offT = rs.reduce((a, r) => a + r.offT, 0) / rs.length;
    const otherOk = rs.filter(r => r.otherRoad && r.end === 'complete').length, otherAll = rs.filter(r => r.otherRoad).length;
    console.log(`${(id + ' ' + LIMITS[id].name).padEnd(14)} ${(secs + ' s / ' + Math.round(dist) + ' m').padEnd(16)} ${pad(ok.length + '/' + rs.length, 8)}  ${pad(ts.length ? f1(med(ts)) : '–', 10)}  ${pad(ts.length ? f1(ts.at(-1)) : '–', 7)}  ${pad(f1(med(hl)) + ' / ' + f1(hl.at(-1)), 26)}  ${pad(crashes, 21)}  ${pad(f1(offT), 10)}  ${pad(otherAll ? otherOk + '/' + otherAll + ' finished' : '–', 16)}`);
    for (const r of rs.filter(r => r.end !== 'complete' || VERBOSE)) console.log(`      ${r.rid} seed ${r.sd}: ${r.end} at ${f1(r.t)} s, ${Math.round(r.s)} m, hull −${f1(r.hullLost)} %${r.why ? ' – ' + r.why : ''} (vehicle ${r.crashV}, building ${r.crashB})`);
    if (ok.length / rs.length < L.finishMin) fails.push(`${id} DRIVE: ${ok.length}/${rs.length} finished (needs ${Math.round(L.finishMin * 100)} %)`);
    if (med(hl) > L.hullLostMax) fails.push(`${id} DRIVE: median hull lost ${f1(med(hl))} % (max ${L.hullLostMax} %)`);
    if (crashes > L.crashesMax) fails.push(`${id} DRIVE: median ride touched ${crashes} vehicle(s) (max ${L.crashesMax})`);
    if (LIMITS[id].road.forksMin && otherAll === 0) fails.push(`${id} DRIVE: no ride took the other road of a fork`);
  }
}
console.log(fails.length ? `\n✘ ${fails.length} problem(s):\n  ` + fails.join('\n  ') : '\n✔ every level is what it says and passable by a human-paced driver');
process.exit(fails.length ? 1 : 0);
