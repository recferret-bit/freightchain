// Live streams in REAL headless Chrome against a RUNNING server – two browsers: a DRIVER (play.html?ride=…, keypair sign-in like e2e-browser.mjs) and a
// SPECTATOR (play.html?watch=…). The spectator replays the recording, writes on the CB, pays (mock) for NIGHT and a SINKHOLE; the driver's game shows the
// line, applies both, stamps them back; the spectator then sees the obstacle where the driver's game put it and the night in the replay. Screenshots of both.
// Usage: FREE_RIDE_SECONDS=120 SOL_USD=118 TREASURY_PUBKEY=<any address> PORT=3111 node dist/main.js   then   BASE=http://localhost:3111 node scripts/e2e-watch.mjs
//   (or: bash .claude/skills/run-tests/e2e.sh watch). CHROME_PORT = the first of two DevTools ports.
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep, driveHook } from '../../client/tools/cdp.mjs';
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
await D.ev(driveHook(20));
let driving = true;
(async () => { const K = [['KeyW', 'w'], ['KeyA', 'a'], ['KeyD', 'd']]; for (let i = 0; driving; i++) { const [code, key] = K[i % 3]; await D.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); await sleep(80 + Math.random() * 300); await D.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key }); await sleep(100 + Math.random() * 400); } })();
check('driver: the first recording batch is uploaded', await until(() => D.ev('__game.telemetry.seq >= 1 && __game.telemetry.queue.length === 0'), 90_000), `seq ${await D.ev('__game.telemetry.seq')}`);

// ── the spectator: first signed out, then signed in ──
const S = await launch({ port: CP + 1, shotsDir: 'fc-watch-shots', evalProblems: true });
await S.send('Page.navigate', { url: `${BASE}/play.html?watch=${ride.id}` }); await boot(S);
check('spectator: watch mode on the driver\'s road (seed + route)', await S.ev(`__game.st.watch && __game.watch.ride.id === ${JSON.stringify(ride.id)} && __game.roads.seed === ${ride.seed}`));
check('spectator: no menu, the watch panel instead', await S.ev('document.getElementById("overlay").classList.contains("hide") && !!document.getElementById("watch")'));
check('spectator (signed out): CONNECT WALLET offered', await until(() => S.ev('[...document.querySelectorAll("#w-me button")].some(b => b.textContent === "CONNECT WALLET")'), 5000));
check('spectator: the replay has samples, with the clock + flags + inputs + fork columns', await until(() => S.ev('__game.watch.rows.length > 50 && __game.watch.rows[0].length === 16'), 20_000), `${await S.ev('__game.watch.rows.length')} rows`);
check('spectator: the driver\'s keys are in the input column (W / A / D pressed)', await S.ev('(({ BIT, INPUT_COL }) => __game.watch.rows.some(r => r[INPUT_COL] & (BIT.gas | BIT.left | BIT.right)))(__game.inputBits)'));
check('spectator: the live view lights them up (the yellow input borders)', await until(() => S.ev('__game.watch.inputs.on && [...__game.watch.inputs.key].some(v => v > 0)'), 20_000));
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
  // the stamp came seconds after the spectator's feed cursor moved past the donation: the watch poll's `since` must still bring it to the page itself
  check('spectator: its OWN feed shows the stamp (✓ on the road), not just the API', await until(() => S.ev(`__game.watch.events.get(${hole.id})?.applied?.placed === true && document.querySelector('.w-line[data-id="${hole.id}"] .w-ap')?.textContent.includes('on the road')`), 15_000));
}
check('spectator: the NIGHT line is stamped on the page too', await until(() => S.ev('[...__game.watch.events.values()].some(e => e.effect === "night" && e.applied)'), 10_000));
await D.shot('driver-cb');
await S.shot('watch-desktop');
// the night as the spectator sees it: once the batch holding the moment it was applied is uploaded, seek there (a live view gets there ~25 s later by itself)
const applied = (await (await fetch(`${BASE}/api/watch/${ride.id}`)).json()).events.find(e => e.effect === 'night')?.applied;
const reached = applied && await until(() => S.ev(`__game.watch.rec.t1 > ${applied.t + 2}`), 60_000);
// a seek into a part that is not loaded must HOLD its target until it is fetched (it used to snap back to the end of what was loaded)
await S.ev(`(() => { const w = __game.watch; for (const [seq] of w.batches) if (seq >= 1) w.batches.delete(seq); w.rows = w.batches.get(0)?.samples.slice() ?? []; w.rowsSeq = 0; })()`);
if (reached) { await S.ev(`(async () => { const m = await import('/js/watch.js'); m.seek(${applied.t + 1.5}); })()`); }
await sleep(100);
check('spectator: a seek into an unloaded part holds its target (no snap back) and plays from there once fetched', !!reached
  && Math.abs((await S.ev('__game.watch.wt')) - (applied.t + 1.5)) < 1 && await until(() => S.ev(`!__game.watch.seeking && Math.abs(__game.st.t - ${applied.t + 1.5}) < 3`), 15_000), `wt ${await S.ev('__game.watch.wt.toFixed(1)')}, st.t ${await S.ev('__game.st.t.toFixed(1)')}`);
check('spectator: the replay turns to night where the driver\'s did', !!reached && await until(() => S.ev('__game.dn.night === true'), 10_000), `t ${applied?.t?.toFixed?.(1)}`);
await S.shot('watch-night');
await S.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true }); await sleep(1200);
await S.shot('watch-phone');
await S.send('Emulation.clearDeviceMetricsOverride');

// chat safety: the driver folds the CB away with K and back; then MUTES the spectator from its line – the spectator's next line is refused
await D.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyK', key: 'k' }); await D.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyK', key: 'k' });
check('driver: K folds the CB panel away', await until(() => D.ev('document.getElementById("cb").classList.contains("folded")'), 3000));
await D.ev('document.querySelector("#cb .cb-head").click()');
check('driver: a click on its header unfolds it', await until(() => D.ev('!document.getElementById("cb").classList.contains("folded")'), 3000));
await D.ev(`[...document.querySelectorAll('#cb .cb-line')].find(l => l.dataset.wallet === ${JSON.stringify(fan.wallet)})?.querySelector('.cb-mute')?.click()`);
const muted = await until(async () => (await (await fetch(`${BASE}/api/watch/${ride.id}`)).json()).events.every(e => e.kind !== 'message'), 8000);
check('driver: MUTE on a CB line hides the spectator\'s chat from every feed', muted);
await S.ev('document.getElementById("w-text").value = "can you hear me"; document.querySelector(".w-say button").click()'); await sleep(800);
check('spectator: muted – its next line is refused', /muted you/.test(await S.ev('document.getElementById("w-msg").textContent')), await S.ev('document.getElementById("w-msg").textContent'));

// the driver ends; the watch page turns into a read-only replay
driving = false;
await D.ev('window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true }))'); await sleep(400);
await D.ev('document.getElementById("endshift")?.click()'); await sleep(1500);
check('spectator: the ended ride becomes a replay, the feed read-only', await until(() => S.ev('__game.watch.ride.live === false && /REPLAY/.test(document.getElementById("w-state").textContent) && !document.getElementById("w-text")'), 20_000));
const inbox = await (await fetch(`${BASE}/api/watch/${ride.id}`)).json();
check('server: the ride\'s feed is kept (1 line + the mock donations)', inbox.totals.messages === 1 && inbox.totals.donations === gifts + 1, JSON.stringify(inbox.totals));   // totals count everything; a muted wallet's lines are only hidden
const pd = D.filt(), ps = S.filt().filter(p => !/401.*\/api\/me|429.*\/donations|403.*\/messages/.test(p));   // by design: the signed-out probe of /api/me (as in landing/tools/e2e-wallet.mjs), the refused second effect, the muted line
check('no page errors (driver)', pd.length === 0, pd.join(' | '));
check('no page errors (spectator)', ps.length === 0, ps.join(' | '));
console.log(`screenshots: ${S.SHOTS}`);
D.finish(fails.length ? 1 : 0, 300); S.finish(fails.length ? 1 : 0, 300);
