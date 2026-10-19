#!/usr/bin/env node
// Trip design – look at the trips in real headless Chrome (client/tools/cdp.mjs): every trip on two routes from ONE seed, the truck parked just before
// the sharpest bend of the first 4 km with the trip's traffic running for a few seconds (trip-<id>-<route>.png), the start of each trip 70 m before the
// depot road meets the main road (start-<id>.png: a STOP line and a right turn, or a straight start), then the end-of-ride stamps: the green
// win (a free run reaching its line – `finish`) and the red fail for comparison (win-stamp.png, fail-stamp.png). Exits 1 on a page exception.
// Usage: serve the game first (cd client && ./serve.sh), then from the repo root:
//   node .claude/skills/trip-design/shots.mjs            env: BASE (http://localhost:8765)  PORT (DevTools, 9338)  SHOTS (dir)  TRIPS  ROUTES
import { launch, sleep, withEntities } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://localhost:8765', PORT = +process.env.PORT || 9338, SEED = 4242;
const TRIPS = (process.env.TRIPS || 'free,1h,4h,8h').split(','), ROUTES = (process.env.ROUTES || 'route66,brenner').split(',');
const { ev, shot, filt, SHOTS, finish, send } = await launch({ port: PORT, shotsDir: 'fc-trip-shots', evalProblems: true });
await send('Page.navigate', { url: await withEntities(`${BASE}/play.html?sim=1`) }); await sleep(3500);
if (await ev('typeof window.__game') !== 'object') { console.log('the game did not boot at', BASE); finish(1); }
await ev('__game.devRun()');   // no helpers; each trip below sets its own road

for (const route of ROUTES) for (const id of TRIPS) {
  const r = await ev(`(() => { const g = __game; g.setTrip(${JSON.stringify(id)}); g.selectTheme(${JSON.stringify(route)}, false); g.st.mode = 'done'; g.startRide(); g.roads.newTrip(${SEED});
    let best = 0, at = g.net.Sm + 600; for (let s = g.net.Sm + 600; s < g.net.Sm + 4000; s += 5) { const k = Math.abs(g.net.curv(s)); if (k > best) { best = k; at = s; } }
    Object.assign(g.st, { s: at - 70, d: 2.4, psi: 0, v: 0, park: true }); document.getElementById('overlay').classList.add('hide');
    return { at: Math.round(at), radius: Math.round(1 / best), trip: g.trip.id }; })()`);
  await sleep(3500);   // chunks stream in, the trip's traffic spawns and moves
  const cars = await ev('__game.traffic.filter(a => a.road.main).length');
  await shot(`trip-${id}-${route}`);
  console.log(`${id.padEnd(4)} ${route.padEnd(10)} sharpest bend R ${r.radius} m at s ${r.at} · ${cars} cars on the main road`);
}

// the start: the truck 70 m before the depot road meets the main road – a STOP line and a right turn, or (a straight start) the road going straight on
for (const id of TRIPS) {
  await ev(`(() => { const g = __game; g.setTrip(${JSON.stringify(id)}); g.selectTheme('route66', false); g.st.mode = 'done'; g.startRide(); g.roads.newTrip(${SEED});
    Object.assign(g.st, { s: g.net.sA - 70, d: 2.4, psi: 0, v: 0, park: true }); document.getElementById('overlay').classList.add('hide'); })()`);
  await sleep(3000); await shot(`start-${id}`);
  console.log(`start-${id}: ${await ev('__game.net.straight ? "straight on" : "STOP line + right turn"')}`);
}

// the stamps: a free run reaching its line ends itself (green), a wreck ends red
const end = async (name, setup) => {
  await ev(`(() => { const g = __game; g.setTrip('free'); g.st.mode = 'done'; g.startRide(); ${setup} })()`);
  for (let i = 0; i < 40 && await ev('__game.st.mode') === 'drive'; i++) await sleep(100);
  await sleep(450); await shot(name);   // the stamp is fully in from ~0.35 s to ~1.5 s
  console.log(`${name}: ${await ev('[...document.querySelectorAll(".fail-stamp")].map(e => e.className + " " + e.textContent).join(" | ")') || 'NO STAMP'}`);
  await sleep(2500);
};
await end('win-stamp', `g.CFG.RIDE_MIN_SECONDS = .5; g.CFG.COMPLETE_DIST = 1; Object.assign(g.st, { s: g.net.Sm + 200, d: 2.4, park: true });`);
await end('fail-stamp', `Object.assign(g.st, { s: g.net.Sm + 200, d: 2.4, park: true, hull: 0 });`);

const problems = filt().filter(p => !/AudioContext|autoplay/i.test(p));
console.log(`screenshots: ${SHOTS}`); if (problems.length) console.log('PROBLEMS:\n' + problems.join('\n'));
finish(problems.some(p => /EXCEPTION|EVAL/.test(p)) ? 1 : 0, 200);
