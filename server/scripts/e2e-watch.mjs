// Live streams in REAL headless Chrome against a RUNNING server – two browsers: a DRIVER (play.html?ride=…, keypair sign-in like e2e-browser.mjs) and a
// SPECTATOR (play.html?watch=…). The spectator replays the recording, writes on the CB, pays (mock) for NIGHT and a SINKHOLE; the driver's game shows the
// line, applies both, stamps them back; the spectator then sees the obstacle where the driver's game put it and the night in the replay. Screenshots of both.
// Usage: FREE_RIDE_SECONDS=120 SOL_USD=118 TREASURY_PUBKEY=<any address> PORT=3111 node dist/main.js   then   BASE=http://localhost:3111 node scripts/e2e-watch.mjs
//   (or: bash .claude/skills/run-tests/e2e.sh watch). CHROME_PORT = the first of two DevTools ports.
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111', CP = +process.env.CHROME_PORT || 9341;
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const post = async (path, body, cookie) => { const r = await fetch(`${BASE}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body) }); return { r, j: await r.json() }; };
const signIn = async () => {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const { j: ch } = await post('auth/nonce', { wallet });
  const { r } = await post('auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) });
  return { wallet, cookie: r.headers.get('set-cookie').split(';')[0] };
};
const until = async (fn, ms, step = 300) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(step); } return false; };
const setCookie = (b, cookie) => { const [name, value] = cookie.split('='); return b.send('Network.setCookie', { name, value, url: BASE, httpOnly: true }); };
const boot = async b => { for (let i = 0; i < 100 && !(await b.ev('!!window.__game')); i++) await sleep(200); };

// ── the driver ──
const driver = await signIn();
const { j: ride } = await post('rides', { tier: 'free' }, driver.cookie);
check('driver: free ride created', ride.status === 'created');
const D = await launch({ port: CP, shotsDir: 'fc-watch-shots', evalProblems: true });
await setCookie(D, driver.cookie);
await D.send('Page.navigate', { url: `${BASE}/play.html?ride=${ride.id}` }); await boot(D);
await D.ev('document.getElementById("go").click()'); await sleep(800);
check('driver: ride running', (await (await fetch(`${BASE}/api/watch/${ride.id}`)).json()).ride?.status === 'running');
// headless can't drive: grow s with the GAME clock at 20 m/s (under the governor) and press keys like a person (see e2e-browser.mjs)
await D.ev('(() => { let last = __game.st.t; setInterval(() => { const g = __game.st; if (g.mode === "drive") g.s += 20 * Math.max(0, g.t - last); last = g.t; }, 50); })()');
let driving = true;
(async () => { const K = [['KeyW', 'w'], ['KeyA', 'a'], ['KeyD', 'd']]; for (let i = 0; driving; i++) { const [code, key] = K[i % 3]; await D.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); await sleep(80 + Math.random() * 300); await D.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key }); await sleep(100 + Math.random() * 400); } })();
check('driver: the first recording batch is uploaded', await until(() => D.ev('__game.telemetry.seq >= 1 && __game.telemetry.queue.length === 0'), 90_000), `seq ${await D.ev('__game.telemetry.seq')}`);

// ── the spectator: first signed out, then signed in ──
const S = await launch({ port: CP + 1, shotsDir: 'fc-watch-shots', evalProblems: true });
await S.send('Page.navigate', { url: `${BASE}/play.html?watch=${ride.id}` }); await boot(S);
check('spectator: watch mode on the driver\'s road (seed + route)', await S.ev(`__game.st.watch && __game.watch.ride.id === ${JSON.stringify(ride.id)} && __game.roads.seed === ${ride.seed}`));
check('spectator: no menu, the watch panel instead', await S.ev('document.getElementById("overlay").classList.contains("hide") && !!document.getElementById("watch")'));
check('spectator (signed out): CONNECT WALLET offered', await until(() => S.ev('[...document.querySelectorAll("#w-me button")].some(b => b.textContent === "CONNECT WALLET")'), 5000));
check('spectator: the replay has samples, with the clock + flags columns', await until(() => S.ev('__game.watch.rows.length > 50 && __game.watch.rows[0].length === 14'), 20_000), `${await S.ev('__game.watch.rows.length')} rows`);
const s1 = await S.ev('__game.st.s'); await sleep(4000); const s2 = await S.ev('__game.st.s');
check('spectator: the truck moves in the replay', s2 > s1 || (await S.ev('__game.watch.buffering')), `${s1?.toFixed?.(1)} → ${s2?.toFixed?.(1)} m`);
check('spectator: counted as a viewer', await until(() => D.ev('__game.liveFeed.viewers >= 1'), 15_000), `${await D.ev('__game.liveFeed.viewers')} watching`);
await S.shot('watch-signed-out');

const fan = await signIn();
await setCookie(S, fan.cookie);
await S.send('Page.navigate', { url: `${BASE}/play.html?watch=${ride.id}` }); await boot(S);
check('spectator (signed in): chat box + donation buttons', await until(() => S.ev('!!document.getElementById("w-text") && document.querySelectorAll(".w-fx button").length === 6'), 8000));
// type a line the way a person does (real key events into the box – none of them may steer anything: st.watch swallows the game keys)
await S.ev('document.getElementById("w-text").focus()');
for (const ch of 'keep on trucking') await S.send('Input.insertText', { text: ch });
await S.ev('document.querySelector(".w-say button").click()');
check('spectator: the line is in the feed', await until(() => S.ev('[...document.querySelectorAll(".w-line")].some(l => l.textContent.includes("keep on trucking"))'), 5000));
check('driver: the line shows on the CB panel', await until(() => D.ev('document.getElementById("cb")?.textContent.includes("keep on trucking")'), 15_000));

const nightBefore = await D.ev('__game.dn.night');
const fx = name => S.ev(`(async () => { [...document.querySelectorAll(".w-fx button")].find(b => b.textContent.includes(${JSON.stringify(name)})).click(); await new Promise(r => setTimeout(r, 400)); return document.getElementById("w-msg").textContent; })()`);
await fx('NIGHT');
const second = await fx('TRENCH');   // right after: the ride's 20 s effect window is taken (windows are fixed buckets of server time – unless the two straddle a boundary)
const both = (await (await fetch(`${BASE}/api/watch/${ride.id}`)).json()).events.filter(e => e.kind === 'donation');
if (both.length === 2) console.log(`NOTE the two clicks straddled a 20 s window boundary (${both.map(e => e.at % 20000).join(' / ')} ms into it) – both taken, by design`);
else check('a second effect inside the 20 s window is refused with the wait', /one effect per 20 s/.test(second), second);
check('driver: the NIGHT donation turns the day into night', await until(() => D.ev('__game.dn.night === true'), 15_000), `before: ${nightBefore}`);
const nightEv = await until(async () => (await (await fetch(`${BASE}/api/watch/${ride.id}`)).json()).events.some(e => e.effect === 'night' && e.applied), 10_000);
check('server: the night effect is stamped (applied)', nightEv);
await sleep(21_000);
const gifts = (await (await fetch(`${BASE}/api/watch/${ride.id}`)).json()).totals.donations;
await S.ev('[...document.querySelectorAll(".w-fx button")].find(b => b.textContent.includes("SINKHOLE")).click()');
let hole = null;
await until(async () => { hole = (await (await fetch(`${BASE}/api/watch/${ride.id}`)).json()).events.find(e => e.effect === 'sinkhole' && e.applied); return !!hole; }, 15_000);
check('driver: the SINKHOLE is put on the road ahead and stamped', !!hole && hole.applied.s > (await D.ev('__game.st.s')) + 500, hole ? `at ${hole.applied.s.toFixed(0)} m, lat ${hole.applied.lat}` : 'not applied');
const holeAt = s => `(() => { const h = __game.holes.holeAt(Math.floor(${s} / __game.CFG.CHUNK_LEN)); return h && h.type === 'sinkhole' && Math.abs(h.s - ${s}) < .01 ? h.lat : null; })()`;
if (hole) {
  check('driver: its own road has the sinkhole there', (await D.ev(holeAt(hole.applied.s))) === hole.applied.lat);
  check('spectator: the replay has the same sinkhole in the same place', await until(async () => (await S.ev(holeAt(hole.applied.s))) === hole.applied.lat, 15_000));
}
await D.shot('driver-cb');
await S.shot('watch-desktop');
// the night as the spectator sees it: once the batch holding the moment it was applied is uploaded, seek there (a live view gets there ~25 s later by itself)
const applied = (await (await fetch(`${BASE}/api/watch/${ride.id}`)).json()).events.find(e => e.effect === 'night')?.applied;
const reached = applied && await until(() => S.ev(`__game.watch.rec.t1 > ${applied.t + 2}`), 60_000);
if (reached) { await S.ev(`(async () => { const m = await import('/js/watch.js'); m.seek(${applied.t + 1.5}); })()`); }
check('spectator: the replay turns to night where the driver\'s did', !!reached && await until(() => S.ev('__game.dn.night === true'), 10_000), `t ${applied?.t?.toFixed?.(1)}`);
await S.shot('watch-night');
await S.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true }); await sleep(1200);
await S.shot('watch-phone');
await S.send('Emulation.clearDeviceMetricsOverride');

// the driver ends; the watch page turns into a read-only replay
driving = false;
await D.ev('window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true }))'); await sleep(400);
await D.ev('document.getElementById("endshift")?.click()'); await sleep(1500);
check('spectator: the ended ride becomes a replay, the feed read-only', await until(() => S.ev('__game.watch.ride.live === false && /REPLAY/.test(document.getElementById("w-state").textContent) && !document.getElementById("w-text")'), 20_000));
const inbox = await (await fetch(`${BASE}/api/watch/${ride.id}`)).json();
check('server: the ride\'s feed is kept (1 line + the mock donations)', inbox.totals.messages === 1 && inbox.totals.donations === gifts + 1, JSON.stringify(inbox.totals));
const pd = D.filt(), ps = S.filt().filter(p => !/401.*\/api\/me|429.*\/donations/.test(p));   // by design: the signed-out probe of /api/me (as in landing/tools/e2e-wallet.mjs) and the refused second effect above
check('no page errors (driver)', pd.length === 0, pd.join(' | '));
check('no page errors (spectator)', ps.length === 0, ps.join(' | '));
console.log(`screenshots: ${S.SHOTS}`);
D.finish(fails.length ? 1 : 0, 300); S.finish(fails.length ? 1 : 0, 300);
