// Capture from an UNMODIFIED checkout, never from the verifier. Usage: node capture-traffic.mjs /path/to/checkout <commit>
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = process.argv[2], commit = process.argv[3];
if (!root || !commit) throw new Error('Pass the baseline checkout and its commit');
const load = f => import(pathToFileURL(`${root}/client/${f}`).href);
const { CFG } = await load('js/config.js'), { net, laneLat, edgeOf } = await load('js/net/network.js');
const { trip, setTrip } = await load('js/trips.js'), geometry = await load('js/road.js');
const { HOLES, holesNear, clearHoleCache } = await load('js/net/obstacles.js');
const { ramp } = await load('js/themes/_shared/profile.js');
const constants = await load('shared/traffic.js'), util = await load('js/util.js');
const original = readFileSync(`${root}/client/js/sim/traffic.js`, 'utf8');
const source = original.replace(/^import .*;\n/gm, '').replace(/\bexport /g, '');
const cases = [];
for (const [i, route] of ['route66', 'stuart', 'siberia', 'brenner', 'panamerican'].entries()) {
  for (const tripId of ['1h', 'free-1c', 'free-2c']) {
    const seed = [424242, 7, 77777, 42, 123456][i], steps = 2400;
    setTrip(tripId);
    const profile = readFileSync(`${root}/client/js/themes/${route}/road.js`, 'utf8').match(/export const curv = (.*);/)[1];
    net.setStyle({ curv: new Function('ramp', `return ${profile}`)(ramp) }); net.reset(seed); clearHoleCache();
    const st = { s: 0, d: 2.4, psi: 0, tyaw: 0, v: 0, vel: 0, hull: 100, rev: false, crashV: 0 };
    let hurts = 0, crossFrames = 0, holeFrames = 0;
    const deps = { ...util, ...Object.fromEntries(['VEHICLES', 'TRUCK_FRONT', 'CAB_BACK', 'HITCH', 'TRAILER_BACK', 'HORIZON', 'PRESETS', 'BEHIND_OK', 'CROSS_OK', 'CALM_OK'].map(k => [k, constants[k]])), sharedBumpDmg: constants.bumpDmg, CFG, st, roadAt: geometry.roadAt, net, laneLat, edgeOf, HOLES, holesNear, trip,
      buildVehicle: () => ({ position: { set() {} }, rotation: {}, userData: {} }), removeVehicle() {}, audio: { play() {}, honk() {} }, hurt: d => { st.hull = Math.max(0, st.hull - d); hurts++; } };
    // TRAFFIC_TYPES is declared by the old browser module, not an imported constant there.
    delete deps.TRAFFIC_TYPES;
    const sim = new Function(...Object.keys(deps), `${source}\nreturn { cars, resetTraffic, updateTraffic, clearStretch };`)(...Object.values(deps));
    sim.resetTraffic((seed ^ 0x9e3779b9) >>> 0);
    const hash = createHash('sha256'), initial = sim.cars.map(a => [a.id, a.def.type, a.preset, a.dir, a.s, a.v]);
    const dts = [1 / 60, 1 / 30, .05, .012]; let t = 0;
    for (let frame = 0; frame < steps; frame++) {
      const dt = dts[frame % dts.length]; t += dt;
      const s = t * 20, heading = geometry.roadAt(s).t;
      Object.assign(st, { s, d: 2.4 + Math.sin(t / 3) * 3.2, psi: .1 * Math.sin(t / 4), tyaw: heading + Math.sin(t / 5) * .3, v: 20, vel: 20, hull: 100, rev: false, crashV: 0 });
      net.clock = t - dt;
      const fatal = sim.updateTraffic(dt);
      const fork = net.forkAt(st.s); if (fork && st.s > fork.f0 + 205 && net.setChoice(fork, 1)) sim.clearStretch(fork.f0, fork.f1);
      crossFrames += sim.cars.some(a => !a.road.main) ? 1 : 0; holeFrames += sim.cars.some(a => a.hz && a.pit) ? 1 : 0;
      const rows = sim.cars.map(a => [a.id, a.def.type, a.preset, a.road.main ? 'main' : a.road.j.id, a.dir, a.s, a.lat, a.v, a.lane, a.target, a.lv, a.state, a.hz, a.dLat, a.dV]);
      hash.update(JSON.stringify([rows, fatal, st.s, st.d, st.v, st.psi, st.hull, st.crashV], (_k, v) => typeof v === 'number' ? Math.round(v * 1e8) / 1e8 : v));
    }
    cases.push({ seed, trip: tripId, route, steps, initial, hash: hash.digest('hex'), hurts, crossFrames, holeFrames });
  }
}
writeFileSync(new URL('./traffic-browser.json', import.meta.url), JSON.stringify({ sourceCommit: commit, description: 'Original browser traffic.js, network, geometry, trips, hole roll and tunables; only renderer/audio/hurt hooks stubbed. Scripted full poses, variable frame durations, fork switches. Hash includes every frame, rounded to 1e-8.', cases }, null, 2) + '\n');
console.log(cases.map(({ route, trip, hurts, crossFrames, holeFrames }) => ({ route, trip, hurts, crossFrames, holeFrames })));
