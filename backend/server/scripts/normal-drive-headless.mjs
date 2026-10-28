// Headless reproduction of the normal-drive acceptance: the REAL game modules (stubbed three.js, fake DOM, like level-check) driven by the REAL
// keyboard-driver.mjs (same key events, same PIKE phone actions). No browser, no server, no clock warp: minutes instead of 90.
//   node backend/server/scripts/normal-drive-headless.mjs [--level HARD] [--seed 1139766526] [--route brenner] [--stuck 60] [--max-s 5400]
// Prints every hull loss (source bucket, speed, lane, cars close by) and, when the stuck watchdog fires, the truck and the cars around it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installKeyboardDriver } from './keyboard-driver.mjs';
import { laneMergeUnsafe } from './lane-merge-safety.mjs';
import { normalFreeCourse } from './normal-drive-course.mjs';
import { longitudinalForces } from '../../../frontend/client/shared/physics.js';
import { createStuckWatchdog, describeStuck } from './normal-drive-stuck.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), CLIENT = join(ROOT, 'frontend/client');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const course = normalFreeCourse(arg('level', 'HARD'));
const SEED = +arg('seed', 1139766526), ROUTE = arg('route', 'brenner'), STUCK = +arg('stuck', 60), MAX_S = +arg('max-s', course.minSeconds * 3);
const TRIP = course.trip, DIST = 28 * course.k * course.minSeconds;

const out = join(tmpdir(), 'freightchain-normal-headless'); mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.js'), bundle = join(out, 'fc-normal.js');
writeFileSync(entry, `import ${JSON.stringify(join(CLIENT, 'js/main.js'))};\nexport { PikeApp } from ${JSON.stringify(join(CLIENT, 'js/phone/apps/pike.js'))};\n`);
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--alias:three=${join(CLIENT, 'tools/stub-three.mjs')}`, `--outfile=${bundle}`, '--log-level=error'], { cwd: CLIENT, stdio: 'inherit' });

let seed = 12345; Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
let now = 1000; Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
const listeners = {}, store = {};
const ctxStub = new Proxy(function () {}, { get: (_, p) => p === 'createLinearGradient' || p === 'createRadialGradient' ? () => ({ addColorStop() {} }) : p === 'measureText' ? () => ({ width: 10 }) : () => {}, set: () => true });
class El { onclick = null; constructor(id) { this.id = id; this.style = {}; this.classList = { add() {}, remove() {}, toggle() {} }; this.textContent = ''; this.innerHTML = ''; } getContext() { return ctxStub; } click() { this.onclick && this.onclick(); } querySelector() { return null; } querySelectorAll() { return []; } append() {} addEventListener() {} appendChild() {} setAttribute() {} }
const els = {}; globalThis.document = { getElementById: id => els[id] ??= new El(id), createElement: () => new El('x'), addEventListener: (k, f) => (listeners['doc:' + k] ??= []).push(f), body: { style: {}, appendChild() {}, append() {}, classList: { add() {}, remove() {}, toggle() {} } }, querySelectorAll: () => [], hidden: false };
globalThis.window = globalThis; globalThis.addEventListener = (k, f) => (listeners[k] ??= []).push(f);
globalThis.KeyboardEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
globalThis.dispatchEvent = e => { for (const f of listeners[e.type] || []) f({ code: e.code, key: e.key, repeat: false, preventDefault() {}, timeStamp: now }); };
globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1; globalThis.AudioContext = undefined;
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
let rafCb = null; globalThis.requestAnimationFrame = f => { rafCb = f; };
globalThis.setTimeout = () => 0;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
let driverTick = null; globalThis.setInterval = f => { driverTick = f; return 1; };   // the driver's 30 ms timer: called by hand once per frame
globalThis.clearInterval = () => {};
const mod = await import(pathToFileURL(bundle).href);
const G = globalThis.__game, { st, CFG } = G;
const step = () => { now += 1000 / 60; const cb = rafCb; rafCb = null; cb(now); };

G.setTrip(TRIP); G.selectTheme(ROUTE, false); G.setGuide({});   // ASSIST off, like the server's free level 3
seed = SEED; now = 1000;
CFG.RIDE_MIN_SECONDS = course.minSeconds; CFG.COMPLETE_DIST = DIST;
st.mode = 'done'; G.startRide(); G.roads.newTrip(SEED); st.mode = 'drive';
await installKeyboardDriver(laneMergeUnsafe, { PikeApp: mod.PikeApp });   // the browser import of the same module is replaced by the bundled one

const watchdog = createStuckWatchdog({ seconds: STUCK });
const near = range => G.traffic.filter(c => Math.abs(c.s - st.s) < range).sort((a, b) => a.s - b.s);
const row = c => `#${c.id} ${c.def?.name ?? '?'} dir${c.dir} ds${(c.s - st.s).toFixed(1)} lat${c.lat.toFixed(1)} v${c.v.toFixed(1)} vDes${c.vDes.toFixed(1)} ${c.state}${c.brake ? ' brake' : ''}${c.wait ? ' wait' : ''}${c.over ? ' over' : ''}`;
let lastHull = st.hull, lastDmg = { ...(st.dmg || {}) }, lastLog = -999, events = 0, result = 'timeout';
const startWall = Date.now();
while (st.t < MAX_S) {
  step();
  if (typeof driverTick === 'function') driverTick();
  if (st.mode !== 'drive') { result = st.complete ? 'complete' : 'ended: ' + (document.getElementById('panel').innerHTML.match(/Reason<\/span><span class="bad">([^<]*)/)?.[1] ?? st.mode); break; }
  if (st.hull < lastHull - 1e-9) {
    const bucket = Object.keys(st.dmg || {}).filter(k => (st.dmg[k] || 0) > (lastDmg[k] || 0) + 1e-9).join(',');
    console.log(`DAMAGE #${++events} t=${st.t.toFixed(1)} s=${st.s.toFixed(0)} hull ${lastHull.toFixed(1)}->${st.hull.toFixed(1)} source=${bucket} v=${st.v.toFixed(1)} d=${st.d.toFixed(1)} lanes=${G.net.lanes(st.s, 1)} target=${window.__keyboardDriver.target} want=${(window.__keyboardDriver.want ?? NaN).toFixed(1)} off=${st.off} cars<14m: ${near(14).map(row).join(' | ') || 'none'}`);
    lastHull = st.hull; lastDmg = { ...st.dmg };
  }
  if (st.t - lastLog >= 60) { lastLog = st.t; console.log(`t=${st.t.toFixed(0)} s=${st.s.toFixed(0)} v=${st.v.toFixed(1)} d=${st.d.toFixed(1)} hull=${st.hull.toFixed(1)} tolls=${window.__keyboardDriver.tolls} wall=${((Date.now() - startWall) / 1000).toFixed(0)}s`); }
  if (process.env.TRACE_FROM && st.t > +process.env.TRACE_FROM && st.t < +process.env.TRACE_TO && Math.round(st.t * 60) % 15 === 0) console.log(`tr t=${st.t.toFixed(2)} s=${st.s.toFixed(1)} v=${st.v.toFixed(2)} rpm=${st.rpm.toFixed(0)} g=${st.gear} clutch=${st.clutch.toFixed(2)} gas=${st.gas.toFixed(2)} psi=${st.psi.toFixed(3)} d=${st.d.toFixed(2)} tgt=${window.__keyboardDriver.target} k=${G.curv(st.s).toFixed(4)} lanes=${G.net.lanes(st.s,1)} steer=${st.steer.toFixed(2)} W=${G.input.gas} sh=${G.input.clutch} want=${(window.__keyboardDriver.want ?? NaN).toFixed(1)} stall=${st.stall.toFixed(1)}`);
  const stuck = watchdog.observe({ t: st.t, v: st.v, s: st.s, mode: st.mode });
  if (stuck) {
    console.log(`STUCK ${stuck}`);
    console.log(JSON.stringify(describeStuck({ ...st, driver: window.__keyboardDriver, pike: { ...G.pike }, input: { ...G.input }, lanes: G.net.lanes(st.s, 1), shiftT: st.shiftT, noStall: st.noStall, rev: st.rev, crash: st.crash, temp: st.temp, cars: near(60).map(c => ({ id: c.id, dir: c.dir, ds: +(c.s - st.s).toFixed(1), lat: +c.lat.toFixed(1), v: +c.v.toFixed(1), vDes: +c.vDes.toFixed(1), state: c.state, brake: c.brake, wait: c.wait, over: c.over, lane: c.lane })) })));
    const pw = (0.4 + 0.6 * st.hull / 100) * (1 - CFG.COLD_POWER * (G.coldK?.() ?? 0));
    console.log('FORCES (pw from hull, cold ignored)', JSON.stringify({ pw: +pw.toFixed(3), ...longitudinalForces(st, CFG, pw, 1, st.off) }));
    result = 'stuck'; break;
  }
}
console.log(`RESULT ${result} t=${st.t.toFixed(0)} s=${st.s.toFixed(0)}/${DIST} hull=${st.hull.toFixed(1)} damage=${JSON.stringify(st.dmg)} events=${events} crashV=${st.crashV} wall=${((Date.now() - startWall) / 1000).toFixed(0)}s`);
process.exit(result === 'complete' ? 0 : 1);
