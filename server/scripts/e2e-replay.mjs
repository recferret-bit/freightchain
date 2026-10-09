// REPLAYS in REAL headless Chrome against a RUNNING server: a finished ride watched from the landing's ticker link (the live stream is e2e-watch.mjs).
// A DRIVER (play.html?ride=…, keypair sign-in like e2e-browser.mjs) drives ~50 s of game time while a fan (API only) pays for NIGHT and – 20 s later – a
// SINKHOLE; the driver's game applies and stamps both; the driver ends the shift. Then a signed-out SPECTATOR opens the replay and checks: REPLAY mode from
// the start, read-only feed with both stamps, 1× vs 16×, the timeline (a seek before / after the night), the paid sinkhole placed from history where the
// driver's game put it, the clock + switch + input columns (a dash click and the keys lit as yellow borders), the end of the ride, an unknown ride id, the phone layout. Screenshots of every step.
// Usage: FREE_RIDE_SECONDS=300 SOL_USD=118 TREASURY_PUBKEY=<any address> PORT=3111 node dist/main.js  (+ `npm run landing:build` – the ticker link is on the landing)
//   then   BASE=http://localhost:3111 node scripts/e2e-replay.mjs      (or: bash .claude/skills/replay-test/run.sh). CHROME_PORT = the first of two DevTools ports.
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111', CP = +process.env.CHROME_PORT || 9361;
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const call = async (method, path, body, cookie) => { const r = await fetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body ? JSON.stringify(body) : undefined }); return { r, j: await r.json().catch(() => ({})) }; };
const signIn = async () => {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const { j: ch } = await call('POST', 'auth/nonce', { wallet });
  const { r } = await call('POST', 'auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) });
  return { wallet, cookie: r.headers.get('set-cookie').split(';')[0] };
};
const until = async (fn, ms, step = 300) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(step); } return false; };
const boot = async b => { for (let i = 0; i < 100 && !(await b.ev('!!window.__game')); i++) await sleep(200); };
const watchApi = async id => (await call('GET', `watch/${id}`)).j;
const stamped = async (id, effect) => (await watchApi(id)).events?.find(e => e.effect === effect && e.applied);

// ── 1. record a ride with two paid effects ──
const driver = await signIn(), fan = await signIn();
const { j: ride } = await call('POST', 'rides', { tier: 'free' }, driver.cookie);
check('driver: free ride created', ride.status === 'created');
const D = await launch({ port: CP, shotsDir: 'fc-replay-shots', evalProblems: true });
const [cn, cv] = driver.cookie.split('=');
await D.send('Network.setCookie', { name: cn, value: cv, url: BASE, httpOnly: true });
await D.send('Page.navigate', { url: `${BASE}/play.html?ride=${ride.id}` }); await boot(D);
await D.ev('document.getElementById("go").click()'); await sleep(800);
// headless can't drive: grow s with the GAME clock at 20 m/s (under the governor) and press keys like a person (see e2e-browser.mjs)
await D.ev('(() => { let last = __game.st.t; setInterval(() => { const g = __game.st; if (g.mode === "drive") g.s += 20 * Math.max(0, g.t - last); last = g.t; }, 50); })()');
let driving = true;
(async () => { const K = [['KeyW', 'w'], ['KeyA', 'a'], ['KeyD', 'd']]; for (let i = 0; driving; i++) { const [code, key] = K[i % 3]; await D.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); await sleep(80 + Math.random() * 300); await D.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key }); await sleep(100 + Math.random() * 400); } })();
check('driver: the first batch is uploaded', await until(() => D.ev('__game.telemetry.seq >= 1'), 90_000));
// a MOUSE click on the dash: the WIPER button (its rect from this frame's dash) – the replay must show it as a click, not a key
const wiperBtn = await D.ev('(b => b && { x: b.x + b.w / 2, y: b.y + b.h / 2 })(__game.uiBtns.find(b => b.id === "wiper"))');
for (const type of ['mousePressed', 'mouseReleased']) { await D.send('Input.dispatchMouseEvent', { type, x: wiperBtn.x, y: wiperBtn.y, button: 'left', clickCount: 1 }); await sleep(90); }
const clickT = await D.ev('__game.st.t');
check('driver: the dash click is recorded (btn:wiper)', await D.ev('__game.telemetry.inputs.some(e => e[1] === "btn:wiper")'), `at t ${clickT?.toFixed?.(1)}`);
const night = await call('POST', `watch/${ride.id}/donations`, { effect: 'night', note: 'lights on' }, fan.cookie);
check('fan: NIGHT donation taken', night.r.ok, JSON.stringify(night.j).slice(0, 120));
let nightAt = null;
check('driver: NIGHT applied and stamped', await until(async () => !!(nightAt = (await stamped(ride.id, 'night'))?.applied), 20_000), nightAt ? `t ${nightAt.t.toFixed(1)}` : '');
await sleep(21_000);   // the ride's effect window
const hole = await call('POST', `watch/${ride.id}/donations`, { effect: 'sinkhole' }, fan.cookie);
check('fan: SINKHOLE donation taken (after the 20 s window)', hole.r.ok, JSON.stringify(hole.j).slice(0, 120));
let holeAt = null;
check('driver: SINKHOLE placed ahead and stamped', await until(async () => !!(holeAt = (await stamped(ride.id, 'sinkhole'))?.applied), 20_000), holeAt ? `s ${holeAt.s.toFixed(0)} m, lat ${holeAt.lat}` : '');
await call('POST', `watch/${ride.id}/messages`, { text: 'great drive' }, fan.cookie);
check('driver: enough recording after the night (≥ 3 batches)', await until(() => D.ev(`__game.telemetry.seq >= 3 && __game.st.t > ${(nightAt?.t ?? 0) + 8}`), 120_000), `seq ${await D.ev('__game.telemetry.seq')}, t ${(await D.ev('__game.st.t'))?.toFixed?.(1)}`);
driving = false;
await D.ev('window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true }))'); await sleep(400);
await D.ev('document.getElementById("endshift")?.click()');
check('driver: shift ended, the last batch flushed', await until(async () => (await watchApi(ride.id)).ride?.live === false && (await D.ev('__game.telemetry.queue.length === 0')), 30_000));
const rec = (await watchApi(ride.id)).recording;
check('server: the recording is kept for the replay', rec.lastSeq >= 2, JSON.stringify(rec));
const pd = D.filt(); check('no page errors (driver)', pd.length === 0, pd.join(' | '));   // (its Chrome closes with the script: finish() exits the process)

// ── 2. the replay, as a signed-out visitor coming from the landing ──
const S = await launch({ port: CP + 1, shotsDir: 'fc-replay-shots', evalProblems: true });
await S.send('Page.navigate', { url: `${BASE}/` });
const link = `#ticker a[href*="watch=${ride.id}"]`;
check('landing: the ticker links the finished ride to its replay', await until(() => S.ev(`!!document.querySelector('${link}')`), 20_000));
const href = await S.ev(`document.querySelector('${link}')?.href`);
await S.send('Page.navigate', { url: href || `${BASE}/play.html?watch=${ride.id}` }); await boot(S);
check('replay: it opens in REPLAY mode (not live), on the driver\'s road', await until(() => S.ev(`__game.st.watch && __game.watch.ride?.live === false && /REPLAY/.test(document.getElementById('w-state')?.textContent ?? '') && __game.roads.seed === ${ride.seed}`), 15_000));
check('replay: it starts at the beginning of the ride', await until(() => S.ev('__game.watch.rows.length > 0 && __game.st.t < 8'), 15_000), `t ${(await S.ev('__game.st.t'))?.toFixed?.(1)}`);
check('replay: speeds shown, LIVE hidden, the timeline spans the recording', await S.ev(`[...document.querySelectorAll('.spd')].every(b => !b.hidden) && document.getElementById('w-live').hidden && Math.abs(+document.getElementById('w-seek').max - ${Math.floor(rec.t1)}) <= 1`));
check('replay: the feed is read-only and has the line + both stamped donations', await until(() => S.ev(`!document.getElementById('w-text') && document.querySelectorAll('.w-line').length === 3 && document.querySelectorAll('.w-ap').length === 2 && [...document.querySelectorAll('.w-ap')].every(a => a.textContent.includes('on the road'))`), 10_000));
check('replay: the sample rows carry the clock + switch + input columns', await S.ev('__game.watch.rows[0].length === 15'));
const clickRow = await S.ev(`(({ BIT, MOUSE, INPUT_COL }) => __game.watch.rows.find(r => (r[INPUT_COL] & (BIT.wiper | MOUSE)) === (BIT.wiper | MOUSE))?.[0] ?? null)(__game.inputBits)`);
check('replay: the dash click is in the input column as WIPER + MOUSE, near when it happened', clickRow !== null && Math.abs(clickRow - clickT) < 1.5, `row t ${clickRow}, clicked at ${clickT?.toFixed?.(1)}`);
check('replay: the driver\'s keys light up while it plays (yellow input borders)', await until(() => S.ev('__game.watch.inputs.on && [...__game.watch.inputs.key].some(v => v > 0)'), 15_000));
check('replay: the driver\'s traffic was recorded beside the batches (2 per second)', await S.ev('__game.watch.tframes.length > 20'), `${await S.ev('__game.watch.tframes.length')} frames`);
check('replay: the recorded vehicles are on the replayed road', await until(() => S.ev('__game.watch.cars.size > 0'), 8000), `${await S.ev('__game.watch.cars.size')} vehicles`);
await S.shot('replay-start');

const rate = async () => { const a = await S.ev('__game.st.t'), t0 = Date.now(); await sleep(3000); return ((await S.ev('__game.st.t')) - a) / ((Date.now() - t0) / 1000); };
const r1 = await rate();
await S.ev(`[...document.querySelectorAll('.spd')].find(b => b.dataset.x === '16').click()`);
const r16 = await rate();
check('replay: 16× plays much faster than 1×', r1 > 0 && r16 > 4 * r1, `${r1.toFixed(2)} vs ${r16.toFixed(2)} game s per wall s (headless runs few frames)`);
await S.ev(`[...document.querySelectorAll('.spd')].find(b => b.dataset.x === '1').click()`);

const seekTo = t => S.ev(`(() => { const s = document.getElementById('w-seek'); s.value = ${t}; s.dispatchEvent(new Event('input')); })()`);
const settled = t => until(() => S.ev(`!__game.watch.seeking && Math.abs(__game.st.t - ${t}) < 4`), 15_000);
if (clickRow !== null) {   // the click, replayed: the WIPER button outlined as a mouse click
  await S.ev(`document.querySelector('.w-fold').click()`);   // on a desktop the panel covers the right of the dash, where WIPER is
  await seekTo(Math.max(0, Math.floor(clickRow - 2))); await settled(clickRow - 2);
  const wiper = await S.ev('__game.inputBits.CONTROLS.indexOf("wiper")'), lightAt = `__game.watch.inputs.mouse[${wiper}] > 0 ? __game.st.t : -1`;   // (-1: the harness reads a null back as undefined)
  const dark = await until(async () => (await S.ev(lightAt)) === -1, 3000, 50);
  let litAt = null;
  await until(async () => (litAt = await S.ev(lightAt)) >= 0, 20_000, 30);
  check('replay: playing over the click lights WIPER as a mouse click (pointer + flashing border on the dash button) – dark before it', dark && litAt >= clickRow - .3, `lit at t ${litAt?.toFixed?.(2)}, the click's sample ${clickRow}`);
  await S.ev(`document.getElementById('w-play').click(); __game.watch.wt = ${clickRow}; __game.watch.jumped = true`);   // paused ON the click's sample: it stays lit
  check('replay: paused on the click\'s sample, it stays lit', await until(() => S.ev(`__game.watch.inputs.mouse[${wiper}] === 1`), 5000));
  await sleep(300); await S.shot('replay-inputs');
  await S.ev(`document.getElementById('w-play').click(); document.querySelector('.w-fold').click()`);
}

if (holeAt) {
  const placed = `(() => { const h = __game.holes.holeAt(Math.floor(${holeAt.s} / __game.CFG.CHUNK_LEN)); return !!h && h.type === 'sinkhole' && Math.abs(h.s - ${holeAt.s}) < .01 && h.lat === ${holeAt.lat}; })()`;
  check('replay: the paid sinkhole is on the road from the start, where the driver\'s game put it', await S.ev(placed));
}
if (nightAt) {
  await seekTo(Math.max(1, Math.floor(nightAt.t - 4)));
  check('replay: a seek to before the NIGHT shows day', (await settled(nightAt.t - 4)) && await until(() => S.ev('__game.dn.night === false'), 8000), `t ${(await S.ev('__game.st.t'))?.toFixed?.(1)}, clock ${(await S.ev('__game.dn.t'))?.toFixed?.(2)}`);
  await seekTo(Math.ceil(nightAt.t + 3));
  check('replay: a seek past it shows night (the clock column)', (await settled(nightAt.t + 3)) && await until(() => S.ev('__game.dn.night === true'), 8000), `clock ${(await S.ev('__game.dn.t'))?.toFixed?.(2)}`);
  await sleep(3000);   // the night fades in
  await S.shot('replay-night');
}
await seekTo(Math.floor(rec.t1) - 2);
check('replay: playing to the end holds the last frame and says the ride is over', await until(() => S.ev(`__game.watch.buffering && /end of the ride/.test(document.getElementById('w-note').textContent) && __game.st.t > ${rec.t1 - 3}`), 20_000), await S.ev(`document.getElementById('w-note').textContent`));
const minHull = await S.ev('Math.min(...__game.watch.rows.map(r => r[7]))');
await sleep(1500);
check('replay: a recorded hit\'s red flash and shake fade (the sim that fades them never runs in a replay)', await S.ev('__game.st.flash < .01 && __game.st.jolt < .01'), `flash ${(await S.ev('__game.st.flash'))?.toFixed?.(2)}, lowest recorded hull ${minHull}`);
check('replay: no traffic SIMULATION in a replay – only the recorded vehicles', await S.ev('__game.traffic.length === 0 && __game.CFG.TRAFFIC === false'));
await S.shot('replay-end');
await S.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true }); await sleep(1200);
await S.shot('replay-phone');
await S.send('Emulation.clearDeviceMetricsOverride');

await S.send('Page.navigate', { url: `${BASE}/play.html?watch=00000000-0000-4000-8000-000000000000` }); await boot(S);
check('replay: an unknown ride says there is nothing to watch', await until(() => S.ev(`/NOTHING TO WATCH/.test(document.querySelector('#watch.w-error')?.textContent ?? '')`), 10_000));
await S.shot('replay-missing');
const ps = S.filt().filter(p => !/404.*\/api\/watch\/00000000|401.*\/api\/me/.test(p));   // by design: the unknown ride's 404, the signed-out probe of /api/me
check('no page errors (spectator)', ps.length === 0, ps.join(' | '));
console.log(`screenshots: ${S.SHOTS}`);
D.finish(fails.length ? 1 : 0, 300); S.finish(fails.length ? 1 : 0, 300);
