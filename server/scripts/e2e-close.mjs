// Closing a page, in REAL headless Chrome against a RUNNING server: every page that counts on the live board must say it left when it goes away
// (the user's report: "closed the second browser, the counters stayed 2 / 1 for minutes"). The landing, the lobby and the watch page send their poll
// once more with leave=1 on pagehide (client/site/presence.js leaveOnClose); the game tab sends a sendBeacon to /end (client/js/online.js).
//   one origin:  FREE_RIDE_SECONDS=20 … node dist/main.js   ·   BASE=http://localhost:3111 node scripts/e2e-close.mjs
//   split hosts (what production does – landing + lobby on the apex, the game on ride.<apex>, the API on api.<apex>, one cookie on the apex; Chrome
//   resolves *.localhost, RESOLVE sends port 80 of those names to the server's port):
//     server: APP_DOMAIN=app.localhost COOKIE_DOMAIN=app.localhost CORS_ORIGINS=http://app.localhost,http://ride.app.localhost FREE_RIDE_SECONDS=20 … node dist/main.js
//     this:   SERVER=http://localhost:3111 BASE=http://app.localhost RESOLVE='MAP app.localhost 127.0.0.1:3111, MAP *.app.localhost 127.0.0.1:3111' node scripts/e2e-close.mjs
// Or: bash .claude/skills/run-tests/e2e.sh close close-split. Checks (each with a 5–8 s budget – without the close signal they take 30 s / 3 min):
//   the landing, the lobby and the watch page drop out of "online" / the ride's viewers; a game tab closed mid-ride ends the ride ABANDONED; Back to it
//   comes from the back/forward cache and reloads instead of driving on (navigation type 'reload'); a COMPLETE shift whose tab closes is COMPLETED and
//   its recording still VERIFIED (closed right after a batch went up – a lost tail only costs coverage, verdict.scenarios.ts covers a whole lost batch).
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep, answerPrompts } from '../../client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111';   // where Chrome opens the landing + lobby
const SERVER = process.env.SERVER || BASE;                   // where this script talks to the API (Node can't resolve *.localhost)
const split = BASE !== SERVER, apex = new URL(BASE).hostname;
const GAME = split ? `http://ride.${apex}` : BASE;           // the game + watch page (hosts.js: ride.<apex> on split hosts)
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${split ? '[split] ' : ''}${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const until = async (fn, ms, step = 300) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(step); } return false; };
const api = async (path, cookie) => (await fetch(`${SERVER}/api/${path}`, { headers: cookie ? { cookie } : {} })).json();
const post = async (path, body, cookie) => fetch(`${SERVER}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body) });
const signIn = async () => {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey), ch = await (await post('auth/nonce', { wallet })).json();
  const res = await post('auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) });
  return { wallet, cookie: res.headers.get('set-cookie').split(';')[0] };
};
const ride = async who => { const r = await (await post('rides', { tier: 'free' }, who.cookie)).json(); return r; };
const online = async () => (await api('live')).online;

const me = await signIn(), driver = await signIn();
const B = await launch({ port: +process.env.CHROME_PORT || 9397, shotsDir: 'fc-close-shots', evalProblems: true, args: process.env.RESOLVE ? [`--host-resolver-rules=${process.env.RESOLVE}`] : [] });
const [cn, cv] = me.cookie.split('=');
await B.send('Network.setCookie', { name: cn, value: cv, httpOnly: true, path: '/', ...(split ? { domain: `.${apex}` } : { url: BASE }) });   // split: Domain = the apex, like COOKIE_DOMAIN
const away = () => B.send('Page.navigate', { url: 'about:blank' });   // = closing the tab (pagehide fires exactly the same)

// ── the landing and the lobby: counted while open, gone within one poll of closing ──
for (const [page, url, ready] of [['landing', `${BASE}/`, `/ON THE ROAD/.test(document.getElementById('chip-live')?.textContent || '')`], ['lobby', `${BASE}/lobby.html#live`, `!!document.getElementById('chip-live')?.textContent`]]) {
  const before = (await online()).browsing;
  await B.send('Page.navigate', { url });
  const counted = await until(async () => (await B.ev(ready)) && (await online()).browsing === before + 1, 20_000);
  check(`${page}: counted online while open`, counted, `browsing ${before} → ${(await online()).browsing}`);
  await away();
  check(`${page}: closing it drops it from "online" at once (pagehide → leave=1)`, await until(async () => (await online()).browsing === before, 5000), `browsing ${(await online()).browsing}`);
}

// ── the watch page: a viewer of a live ride while open, not after ──
const live = await ride(driver);
await post(`rides/${live.id}/start`, {}, driver.cookie); await post(`rides/${live.id}/heartbeat`, { s: 0, t: 0, hull: 100 }, driver.cookie);
const viewers = async () => (await api('live')).rides.find(r => r.id === live.id)?.viewers ?? -1;
await B.send('Page.navigate', { url: `${GAME}/play.html?watch=${live.id}` });
// wait until the page is really up (the scene built, the panel drawn) – closing it mid-boot, while software WebGL holds the main thread, can lose the
// pagehide beacon; that case falls back to the 30 s window, like a crash
const up = `document.readyState === 'complete' && !!window.__game?.watch?.ride && !!document.getElementById('watch')`;
check('watch page: counted as a viewer of the ride while open', await until(async () => (await B.ev(up)) && (await viewers()) === 1 && (await online()).watching === 1, 30_000), `viewers ${await viewers()}`);
await sleep(1000);
await away();
check('watch page: closing it drops the viewer at once', await until(async () => (await viewers()) === 0 && (await online()).watching === 0, 5000), `viewers ${await viewers()}`);
await post(`rides/${live.id}/end`, { outcome: 'failed', s: 0, t: 1, reason: 'test over' }, driver.cookie);

// ── the game tab, closed mid-ride: the ride ends ABANDONED now; Back must not drive it on ──
const boot = async () => { await until(() => B.ev(`!!document.getElementById('go') && !!window.__game`), 30_000); };
const quit = await ride(me);
await B.send('Page.navigate', { url: `${GAME}/play.html?ride=${quit.id}` }); await boot();
if (split) check('split hosts: the game runs on ride.<apex> and talks to api.<apex> (the beacons below cross subdomains, on the apex cookie)',
  (await B.ev('location.hostname')) === `ride.${apex}` && (await B.ev(`import('/js/hosts.js').then(h => h.API_BASE)`)) === `http://api.${apex}`, await B.ev('location.hostname'));
await B.ev(`document.getElementById('go').click()`);
check('game tab: the ride is on the road', await until(async () => (await api('live')).rides.some(r => r.id === quit.id), 15_000));
const driving = (await online()).driving;
await away();
check('game tab: closing it mid-ride ENDS the ride (abandoned) – off the road, one driver less', await until(async () => {
  const [l, r] = await Promise.all([api('live'), api(`rides/${quit.id}`, me.cookie)]);
  return !l.rides.some(x => x.id === quit.id) && l.online.driving === driving - 1 && r.status === 'abandoned';
}, 8000), (await api(`rides/${quit.id}`, me.cookie)).status);
const hist = await B.send('Page.getNavigationHistory');
await B.send('Page.navigateToHistoryEntry', { entryId: hist.entries[hist.currentIndex - 1].id });
const back = await until(async () => /abandoned/.test(await B.ev(`document.getElementById('panel')?.textContent || ''`)) && await B.ev(`!!document.getElementById('go')?.disabled`), 20_000);
const navType = await B.ev(`performance.getEntriesByType('navigation')[0]?.type`);
check('Back: the page says the ride is abandoned and offers no START', back, (await B.ev(`(document.getElementById('panel')?.textContent || '').slice(0, 100)`)));
check('Back: it really came from the back/forward cache, and pageshow reloaded it (navigation type "reload", not "back_forward")', navType === 'reload', navType);

// ── a COMPLETE shift whose tab closes: COMPLETED, and the recording that made it up is VERIFIED ──
const done = await ride(me);
await B.send('Page.navigate', { url: `${GAME}/play.html?ride=${done.id}` }); await boot();
await B.ev(`document.getElementById('go').click()`); await sleep(800);
// headless can't drive: grow s with the GAME clock at 20 m/s (under the governor) and press keys like a person (as in e2e-browser.mjs – the verdict reads them)
await B.ev('__game.trip.finish = false');   // the free run ends itself at the line (client/js/trips.js); this check is about the tab closing on a complete shift that drives on
await B.ev('(() => { let last = __game.st.t; setInterval(() => { const g = __game.st; if (g.mode === "drive") g.s += 20 * Math.max(0, g.t - last); last = g.t; }, 50); })()');
const press = async (code, key, hold) => { await B.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); await sleep(hold); await B.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key }); };
const KEYS = [['KeyW', 'w'], ['KeyA', 'a'], ['KeyD', 'd'], ['KeyW', 'w'], ['ArrowUp', 'ArrowUp']];
const stopPrompts = answerPrompts({ ev: B.ev, send: B.send });   // dispatch prompts arrive with the heartbeats of a 20 s shift – answered like a person, so the verdict stays VERIFIED
const t0 = Date.now();
for (let i = 0; !(await B.ev('__game.st.complete')) && Date.now() - t0 < 120_000; i++) { const [code, key] = KEYS[i % KEYS.length]; await press(code, key, 60 + Math.random() * 340); await sleep(80 + Math.random() * 420); }
check('complete shift: the client says complete', await B.ev('__game.st.complete'), `t=${await B.ev('__game.st.t.toFixed(1)')} s`);
const seq = await B.ev('__game.telemetry.seq');   // close right after the NEXT batch went up, so only a sliver of recording dies with the tab
for (let i = 0; !(await B.ev(`__game.telemetry.seq > ${seq} && __game.telemetry.queue.length === 0`)) && Date.now() - t0 < 240_000; i++) { const [code, key] = KEYS[i % KEYS.length]; await press(code, key, 60 + Math.random() * 340); await sleep(80 + Math.random() * 420); }
stopPrompts();
await away();
let end = null;
check('complete shift: closing the tab COMPLETES it (the /end beacon – no END SHIFT pressed)', await until(async () => (end = await api(`rides/${done.id}`, me.cookie)).status === 'completed', 8000), end?.status);
check('complete shift: its recording is judged VERIFIED (the tail that died with the tab only costs coverage)', end?.verdict?.status === 'verified', JSON.stringify(end?.verdict));

const probs = B.filt().filter(p => !/401.*\/api\/me/.test(p));
check('no page errors', probs.length === 0, probs.join(' | '));
console.log(`screenshots: ${B.SHOTS}`);
B.finish(fails.length ? 1 : 0, 300);
