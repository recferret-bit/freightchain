import { acceptLocalTestTerms } from './local-test-terms.mjs';
// The SERVER's road, end to end, against a RUNNING server (`bash .claude/skills/run-tests/e2e.sh road` starts one: FREE_RIDE_SECONDS=30, prompts off):
//   A. an HONEST driver in real headless Chrome: the game rolls the server-seeded shared obstacle rules locally, cruises in the right-hand
//      lane at ~80 km/h straight through the first planned sinkholes in it and takes the damage → COMPLETED · VERIFIED, the holes HIT
//   B. a CHEATER in real headless Chrome: the same drive, but the holes are taken out of the game first (the plan follower stopped, CFG.HOLES off, the cache
//      cleared – nothing on its road, nothing to hit) → the server still judges the recording on ITS holes: COMPLETED · REJECTED obstacle-ignored
//   C. both finished training rides remain unavailable as public replays
//   D. the ride-audit tool (scripts/ride-audit.mjs) on the same database: the honest ride OK (exit 0), the cheater NOT OK (exit 1), --latest lists both
// Usage: BASE=http://localhost:3111 CHROME_PORT=9370 AUDIT_BUILD=.e2e-build-123 DATABASE_URL=… node scripts/e2e-road-check.mjs   (~5–8 min: the trucks must reach the holes)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://localhost:3111', PORT = +process.env.CHROME_PORT || 9370, SHOTS = 'fc-road-shots';
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const call = async (method, path, { body, cookie } = {}) => {
  const res = await fetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, j: await res.json().catch(() => ({})) };
};
async function signIn() {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const { j: ch } = await call('POST', 'auth/nonce', { body: { wallet } });
  const res = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) }) });
  return { wallet, cookie: await acceptLocalTestTerms(BASE, res.headers.get('set-cookie').split(';')[0]) };
}
const codes = v => (v?.reasons ?? []).map(x => x.code);
const LANE = 2.4, SPEED = 16, HOLES_TO_CROSS = 2;

/* ───────────── A + B: a driver in Chrome ───────────── */
async function drive({ port, mode }) {
  const who = await signIn();
  const { j: ride } = await call('POST', 'rides', { body: { tier: 'free', level: 2 }, ...who });   // MEDIUM: its sinkholes start 400 m in, mostly on 1+1 road (EASY has none within reach, and four lanes)
  const tab = await launch({ port, shotsDir: SHOTS, evalProblems: true });
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: .5, mobile: false });
  const [name, value] = who.cookie.split('=');
  await tab.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
  await tab.send('Page.navigate', { url: `${BASE}/play.html?ride=${ride.id}` });
  for (let i = 0; i < 100 && !(await tab.ev('!!window.__game')); i++) await sleep(200);
  await tab.ev('document.getElementById("go").click()'); await sleep(800);
  // A running ride's public road route is 404. The judge and driver use the same seeded shared generator.
  const road = await call('GET', `watch/${ride.id}/road?from=0&to=9000`);
  const build = process.env.AUDIT_BUILD || 'dist';
  const { roadPlanFor } = await import(pathToFileURL(path.resolve(build, 'domain/road/road-plan.js')).href);
  const plan = roadPlanFor(ride.seed, ride.trip).window(ride.id, 0, 9000);
  const own = plan.holes.filter(h => Math.abs(h.lat - LANE) < 0.01).slice(0, HOLES_TO_CROSS), target = (own.at(-1)?.s ?? 1000) + 40;
  if (mode === 'cheat') await tab.ev(`(() => { const g = __game; g.roadPlan.rideId = null; g.CFG.HOLES = false; g.holes.plan.seed = -1; g.holes.clearHoleCache(); for (const ci of [...g.chunks.keys()]) g.roadObjects.rebuild(ci); })()`);   // what an injected script does: no holes in this game
  const holesInGame = await tab.ev(`__game.holes.holesNear(${own[0]?.s ?? 0} - 5, ${own[0]?.s ?? 0} + 5).length`);
  // cruise in the lane at SPEED with the gas held (a person's keys go down too – the verdict wants real presses); the truck's own physics moves it
  await tab.ev('__game.trip.finish = false');   // the free run would end itself at its (short) line before the holes – drive on past it
  // 7th, warm, pedal down: a pinned speed with the pedal up is a coasting flag, and a cold engine at that speed wears the hull (the cheater must stay unmarked).
  // A car in this lane gets a step into the oncoming lane; both lanes busy, the truck eases off instead of driving through it. Back in lane for each hole.
  const holeS = JSON.stringify(own.map(h => h.s));
  await tab.ev(`(() => { const g = __game, HOLES = ${holeS}, LANE = ${LANE}, SPEED = ${SPEED}; g.st.park = false; g.st._holdV = 0; setInterval(() => {
    if (g.st.mode !== 'drive') return;
    const gate = g.st.s < 130 ? 130 : 130 + (Math.floor((g.st.s - 130) / 8000) + 1) * 8000;
    if (g.pike) { g.pike.paid = gate; g.pike.phase = 'open'; g.pike.gate = gate; }
    g.st.park = false; g.st.keyOn = true; g.st.engineOn = true; g.st.gear = 7; g.st.clutch = 0; g.st.gas = 1; g.st.brake = 0; g.st.temp = 85; g.st.noStall = 2;
    g.input.gas = 1; g.input.brake = 0;
    const s = g.st.s, cars = g.traffic || [];
    const close = (lat, span) => cars.some(a => a && Math.abs(a.lat - lat) < 2.2 && Math.abs(a.s - s) < span);
    const nearHole = HOLES.some(h => h - s > -22 && h - s < 65);
    const threat = close(LANE, g.st._dodge ? 30 : 65);
    if (!nearHole && threat && !close(-LANE, 50)) g.st._dodge = true; else if (!threat || nearHole) g.st._dodge = false;
    let want = SPEED;
    if (threat && !g.st._dodge) { const ahead = cars.filter(a => a.s > s && a.s - s < 65 && Math.abs(a.lat - LANE) < 2.2).sort((a, b) => a.s - b.s); if (ahead[0]) want = Math.min(SPEED, Math.max(0, (ahead[0].dir > 0 ? ahead[0].v : 0) - 3), Math.max(0, (ahead[0].s - s - 25) / 3)); }
    // A hole drops the recorded speed. Climb back no faster than 0.25 m/s per 0.1 s, or the torque check rejects the snap back to cruise.
    const live = Math.min(g.st._holdV ?? g.st.v, g.st.v);
    let base = want < live ? want : live;
    if (want >= live && g.st.t - (g.st._holdT || 0) >= 0.1) { base = Math.min(want, live + 0.25); g.st._holdT = g.st.t; }
    g.st._holdV = base; g.st.v = g.st.vel = base; g.st.d = g.st._dodge ? -LANE : LANE; g.st.psi = 0;
  }, 16); })()`);
  const press = async (code, key, hold) => { await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); await sleep(hold); await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key }); };
  const KEYS = [['KeyW', 'w'], ['KeyA', 'a'], ['KeyD', 'd'], ['KeyW', 'w'], ['ArrowUp', 'ArrowUp']];
  const t0 = Date.now();
  for (let i = 0; (await tab.ev('__game.st.s')) < target || !(await tab.ev('__game.st.complete')); i++) {
    if (Date.now() - t0 > 12 * 60_000 || (await tab.ev('__game.st.mode')) !== 'drive') break;
    const [code, key] = KEYS[i % KEYS.length];
    await press(code, key, 60 + Math.random() * 340); await sleep(80 + Math.random() * 420);
  }
  const reached = await tab.ev('__game.st.s'), hull = await tab.ev('__game.st.hull'), mismatches = await tab.ev('__game.holes.plan.mismatches.length');
  await tab.shot(`${mode}-driving`);
  await tab.ev('window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true }))'); await sleep(500);
  await tab.ev('document.getElementById("endshift")?.click()'); await sleep(3000);
  const text = await tab.ev('document.getElementById("verdict")?.textContent');
  await tab.shot(`${mode}-done`);
  const { j: end } = await call('GET', `rides/${ride.id}`, who);
  const problems = tab.filt().filter(p => !/road plan|\/road\?from=/.test(p));
  tab.close?.();
  return { who, ride, own, target, reached, hull, roadStatus: road.status, mismatches, holesInGame, text, end, problems };
}

/* ───────────── C: a spectator ───────────── */
async function spectate({ port, ride, shot }) {
  const tab = await launch({ port, shotsDir: SHOTS, evalProblems: true });
  await tab.send('Page.navigate', { url: `${BASE}/play.html?watch=${ride.id}` });
  for (let i = 0; i < 100 && !(await tab.ev('!!(window.__game && __game.watch.rows.length > 50)')); i++) await sleep(200);
  for (let i = 0; i < 60 && !(await tab.ev('__game.holes.plan.holes.size > 0')); i++) await sleep(250);
  for (let i = 0; i < 60 && !(await tab.ev('__game.watch.road.size > 0')); i++) await sleep(250);
  const out = {
    planHoles: await tab.ev('__game.holes.plan.holes.size'), mismatches: await tab.ev('__game.holes.plan.mismatches.length'),
    road: await tab.ev('document.getElementById("w-road")?.textContent ?? ""'), ignoredMarks: await tab.ev('document.querySelectorAll(".w-mark.ignored").length'),
    hitMarks: await tab.ev('document.querySelectorAll(".w-mark.hit").length'),
  };
  const first = await tab.ev('(() => { const o = [...__game.watch.road.values()].filter(x => x.outcome === "ignored").sort((a, b) => a.t - b.t)[0]; return o ? { t: o.t, hole: o.hole, s: o.s } : null; })()');
  out.first = first;
  if (first) {
    out.serverHoleOnRoad = await tab.ev(`(() => { const h = __game.holes.holeAt(${Number(first.hole.slice(1))}); return !!h && h.id === ${JSON.stringify(first.hole)} && Math.abs(h.s - ${first.s}) < 0.5; })()`);
    await tab.ev(`(() => { __game.watch.follow = false; __game.watch.speed = 4; __game.watch.playing = true; __game.watch.wt = ${first.t} - 4; __game.watch.jumped = true; __game.watch.seeking = true; })()`);   // 4×: headless Chrome plays slow
    for (let i = 0; i < 200 && !(await tab.ev('!!__game.watch.stamp && !document.getElementById("w-stamp").hidden')); i++) await sleep(150);   // the panel paints it within 250 ms
    await tab.ev('__game.watch.playing = false');   // hold the picture with the stamp up for the screenshot
    out.stamp = await tab.ev('!!__game.watch.stamp && !document.getElementById("w-stamp").hidden');
    out.stampText = await tab.ev('document.getElementById("w-stamp")?.textContent ?? ""');
    out.redRing = await tab.ev(`__game.holes.flagged.has(${JSON.stringify(first.hole)})`);
    await sleep(300); await tab.shot(shot);
  } else await tab.shot(shot);
  out.problems = tab.filt().filter(p => !/api\/me/.test(p));   // a spectator who is not signed in: /api/me answers 401, as it should
  tab.close?.();
  return out;
}

/* ───────────── D: the audit tool ───────────── */
const audit = (...a) => { const r = spawnSync(process.execPath, ['scripts/ride-audit.mjs', ...a], { encoding: 'utf8', env: process.env }); return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }; };

/* ───────────── run ───────────── */
console.log(`the server's road e2e against ${BASE}`);
const [honest, cheat] = await Promise.all([drive({ port: PORT, mode: 'honest' }), drive({ port: PORT + 1, mode: 'cheat' })]);

check('both new rides require hashed frame-level traffic proof', honest.end.trafficVersion === 1 && cheat.end.trafficVersion === 1, `${honest.end.trafficVersion} / ${cheat.end.trafficVersion}`);
check('A honest: the public road route is 404 while the ride is running, and the local roll matches the generator', honest.roadStatus === 404 && honest.mismatches === 0, `road ${honest.roadStatus}, ${honest.mismatches} mismatches`);
check(`A honest: drove through ${HOLES_TO_CROSS} planned sinkholes in its lane`, honest.own.length === HOLES_TO_CROSS && honest.reached >= honest.target && honest.holesInGame > 0, `holes at ${honest.own.map(h => Math.round(h.s)).join(', ')} m, reached ${Math.round(honest.reached)} m`);
check('A honest: the game took the damage', honest.hull < 90, `hull ${honest.hull?.toFixed?.(1)} %`);
check('A honest: COMPLETED · VERIFIED (no road reason)', honest.end.verdict?.status === 'verified' && /VERIFIED/.test(String(honest.text)), `${honest.text} ${JSON.stringify(honest.end.verdict?.reasons)}`);
check('A honest: no page errors', honest.problems.length === 0, honest.problems.join(' | '));
check('B cheater: the holes were gone from its game', cheat.holesInGame === 0, `${cheat.holesInGame} holes near the first planned one`);
check(`B cheater: drove through the same kind of stretch (${HOLES_TO_CROSS} planned holes in its lane) without the hole damage`, cheat.own.length === HOLES_TO_CROSS && cheat.reached >= cheat.target && cheat.hull >= 90, `hull ${cheat.hull} %, reached ${Math.round(cheat.reached)} m`);   // a sinkhole takes ~19%; a traffic graze beside the hole is not that
check('B cheater: COMPLETED · REJECTED obstacle-ignored', cheat.end.status === 'completed' && cheat.end.verdict?.status === 'rejected' && codes(cheat.end.verdict).includes('obstacle-ignored'), `${cheat.text} ${codes(cheat.end.verdict).join(',')}`);
check('B cheater: the end panel says REJECTED', /REJECTED/.test(String(cheat.text)), String(cheat.text));

const [seeCheat, seeHonest] = await Promise.all([call('GET', `watch/${cheat.ride.id}`), call('GET', `watch/${honest.ride.id}`)]);
check('C a finished training ride is not a public replay', seeCheat.status === 404 && seeCheat.j.code === 'replay_not_available' && seeHonest.status === 404 && seeHonest.j.code === 'replay_not_available', `${seeCheat.j.code} ${seeHonest.j.code}`);

if (process.env.AUDIT_BUILD && process.env.DATABASE_URL) {
  const a = audit(honest.ride.id), b = audit(cheat.ride.id), l = audit('--latest', '5');
  check('D audit: the honest ride is OK (exit 0)', a.code === 0 && /RESULT {5}OK/.test(a.out) && /HIT/.test(a.out), a.out.split('\n').slice(-2).join(' / '));
  check('D audit: the cheater is NOT OK (exit 1), the holes listed as IGNORED', b.code === 1 && /NOT OK/.test(b.out) && /IGNORED/.test(b.out) && /obstacle-ignored/.test(b.out), b.out.split('\n').slice(-2).join(' / '));
  check('D audit: --latest lists both rides, one line each', l.code === 1 && l.out.includes(honest.ride.id) && l.out.includes(cheat.ride.id), l.out.split('\n').slice(0, 3).join(' / '));
  console.log('\n' + b.out);
} else console.log('(D skipped: AUDIT_BUILD + DATABASE_URL not set)');

console.log(fails.length ? `\n✘ ${fails.length} check(s) failed: ${fails.join('; ')}` : `\n✔ the server's road: all checks passed (screenshots in ${SHOTS}/)`);
process.exit(fails.length ? 1 : 0);
