// Click-through of the whole loop FROM THE LOBBY in real headless Chrome (two browsers: a rider and an observer), screenshots of every tab at desktop and phone width.
// Server: FREE_RIDE_SECONDS=3 SOL_USD=118 TREASURY_PUBKEY=<any address> PORT=3111 DB_PATH=:memory: node dist/main.js     then:   BASE=http://localhost:3111 node scripts/e2e-lobby.mjs
// No wallet extension: a keypair signs the challenge and the session cookie is handed to Chrome. Paid payments can't be clicked through (no wallet) – covered by vitest / devnet-pay.mjs.
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111';
const fails = []; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const post = async (p, b, c) => { const r = await fetch(`${BASE}/api/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(c && { cookie: c }) }, body: JSON.stringify(b) }); return { r, j: await r.json() }; };
async function wallet() {
  const kp = nacl.sign.keyPair(), address = bs58.encode(kp.publicKey), { j } = await post('auth/nonce', { wallet: address });
  const { r } = await post('auth/verify', { wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) });
  return { address, short: `${address.slice(0, 4)}…${address.slice(-4)}`, cookie: r.headers.get('set-cookie').split(';')[0] };
}
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
async function open(h, w, url) { const [n, v] = w.cookie.split('='); await h.send('Network.setCookie', { name: n, value: v, url: BASE, httpOnly: true }); await h.send('Page.navigate', { url }); }
const size = (h, w, hgt, mobile) => h.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile });

const A = await wallet(), B = await wallet();
const rider = await launch({ port: 9341, shotsDir: 'fc-lobby-shots', evalProblems: true }), obs = await launch({ port: 9342, shotsDir: 'fc-lobby-shots', evalProblems: true });
await size(rider, 1100, 900, false); await size(obs, 1100, 900, false);

// ── NEW RIDE
await open(rider, A, `${BASE}/lobby.html#new`);
check('lobby renders: tier cards', await until(async () => (await rider.ev('document.querySelectorAll(".tier").length')) === 4));
check('header shows the wallet, 5 free rides', (await rider.ev('document.getElementById("chip-wallet").textContent')) === A.short && /5 free rides/.test(await rider.ev('document.getElementById("chip-free").textContent')), await rider.ev('document.getElementById("chip-free").textContent'));
check('pool card shows the grand prize', /SOL/.test(await rider.ev('document.querySelector(".pool .big").textContent')), await rider.ev('document.querySelector(".pool .big").textContent'));
check('free tier preselected, START says FREE', (await rider.ev('document.getElementById("start").textContent')) === 'START FREE RIDE');
await rider.shot('new-desktop');
await rider.ev('[...document.querySelectorAll(".tier")][1].click()');
check('selecting 1H shows the price + the non-refundable condition', /PAY \$5/.test(await rider.ev('document.getElementById("start").textContent')) && /non-refundable/.test(await rider.ev('document.getElementById("rules").textContent')), await rider.ev('document.getElementById("start").textContent'));
await rider.ev('document.getElementById("start").click()');   // no wallet extension here
check('paid click without a wallet: a clear message, no order made', await until(async () => /No Solana wallet/.test(await rider.ev('document.getElementById("msg").textContent') || '')), await rider.ev('document.getElementById("msg").textContent'));
check('…and no stray order exists', (await (await fetch(`${BASE}/api/rides/pending`, { headers: { cookie: A.cookie } })).json()).ride === null);
await rider.ev('[...document.querySelectorAll(".tier")][0].click()');
await size(rider, 390, 844, true); await sleep(300); await rider.shot('new-phone'); await size(rider, 1100, 900, false);

// ── START FREE RIDE → game
await rider.ev('document.getElementById("start").click()');
check('START FREE RIDE opens play.html?ride=…', await until(async () => /\/play\.html\?ride=/.test(await rider.ev('location.pathname + location.search'))));
check('game booted with the server ride', await until(async () => await rider.ev('!!window.__game && __game.CFG.RIDE_MIN_SECONDS === 3')));
await rider.ev('document.getElementById("go").click()'); await sleep(800);
await rider.ev('__game.st.s = 60');

// ── LIVE (second browser)
await open(obs, B, `${BASE}/lobby.html#live`);
check('LIVE tab shows the rider\'s truck', await until(async () => (await obs.ev('document.getElementById("rides")?.textContent || ""')).includes(A.short)), (await obs.ev('document.getElementById("rides")?.textContent || ""')).slice(0, 120));
check('…with its tier badge and a progress bar', /TEST RIDE/.test(await obs.ev('document.getElementById("rides").textContent')) && (await obs.ev('document.querySelectorAll(".road .fill").length')) >= 1);
check('header live counter ≥ 1', /^[1-9]/.test(await obs.ev('document.getElementById("chip-live").textContent')), await obs.ev('document.getElementById("chip-live").textContent'));
await obs.shot('live-desktop'); await size(obs, 390, 844, true); await sleep(400); await obs.shot('live-phone');

// ── finish the shift, back to the lobby
check('shift complete in the client', await until(async () => await rider.ev('__game.st.complete'), 40000), `t=${await rider.ev('__game.st.t.toFixed(1)')}`);
await rider.ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true }))'); await sleep(500);
await rider.ev('document.getElementById("endshift")?.click()');
check('server verdict COMPLETED on the result screen', await until(async () => (await rider.ev('document.getElementById("verdict")?.textContent')) === 'COMPLETED'));
await rider.ev('document.getElementById("lobby").click()');
check('BACK TO LOBBY returns to the lobby', await until(async () => (await rider.ev('location.pathname')) === '/lobby.html'));
check('…and the free-ride count dropped to 4', await until(async () => /4 free rides/.test(await rider.ev('document.getElementById("chip-free").textContent'))));
check('the finished ride left the live feed', await until(async () => { await sleep(5200); return !(await obs.ev('document.getElementById("rides")?.textContent || ""')).includes(A.short); }, 15000));

// ── payment-recovery branch: a wallet with an UNPAID order opens the lobby (checkPending → reconcile runs once, against the real RPC)
const C = await wallet(); await post('rides', { tier: '1h' }, C.cookie);
const third = await launch({ port: 9343, shotsDir: 'fc-lobby-shots', evalProblems: true }); await size(third, 1100, 900, false);
await open(third, C, `${BASE}/lobby.html#new`);
check('lobby with an unpaid order: tier cards render, START enabled', await until(async () => (await third.ev('document.querySelectorAll(".tier").length')) === 4 && (await third.ev('document.getElementById("start").disabled')) === false));
check('…the recovery check finishes (note cleared, or "Could not check…" if the RPC is down)', await until(async () => { const t = await third.ev('document.getElementById("pendingbox").textContent'); return t === '' || /Could not check/.test(t); }, 30000), JSON.stringify(await third.ev('document.getElementById("pendingbox").textContent')));
check('…and no page errors on that path', third.filt().length === 0, third.filt().join(' | '));

// ── PROFILE
await rider.ev('location.hash = "#profile"');
check('PROFILE: stats + achievements unlocked + the ride in history', await until(async () => (await rider.ev('document.querySelectorAll(".a").length')) === 7));
const ach = await rider.ev('[...document.querySelectorAll(".a")].map(a => (a.classList.contains("lock") ? "-" : "+") + a.querySelector(".nm").textContent).join("|")');
check('First Mile + Shift Complete unlocked, Top 20 locked', /\+First Mile/.test(ach) && /\+Shift Complete/.test(ach) && /-Top 20/.test(ach), ach);
check('history lists the ride as COMPLETED', /COMPLETED/.test(await rider.ev('document.querySelector(".hist")?.textContent || ""')));
await rider.shot('profile-desktop'); await size(rider, 390, 844, true); await sleep(300); await rider.shot('profile-phone'); await size(rider, 1100, 900, false);

// ── LEADERBOARD (free board) + reload keeps the tab
await rider.ev('location.hash = "#board"'); await until(async () => (await rider.ev('document.querySelectorAll(".seg button").length')) === 3);
await rider.ev('[...document.querySelectorAll(".seg button")][2].click()');
check('LEADERBOARD › FREE: the rider is #1 and highlighted', await until(async () => /1/.test(await rider.ev('document.querySelector("tr.me .rk")?.textContent || ""'))));
await rider.shot('board-desktop'); await size(rider, 390, 844, true); await sleep(300); await rider.shot('board-phone'); await size(rider, 1100, 900, false);
await rider.send('Page.reload'); check('reload keeps the tab (#board)', await until(async () => (await rider.ev('document.querySelector(".tabs a.on")?.dataset.tab')) === 'board'));
await obs.send('Page.navigate', { url: `${BASE}/lobby.html#new` }); await sleep(1500);

// ── LANDING (signed in: no forced redirect, CTA becomes the lobby link; public numbers agree with the API)
await open(obs, B, `${BASE}/`);
check('landing: stays on / and shows the pool', await until(async () => (await obs.ev('location.pathname')) === '/' && /SOL$/.test(await obs.ev('document.querySelector("#poolbox .big")?.textContent || ""'))));
check('landing: 4 shifts + three boards rendered', (await obs.ev('document.querySelectorAll("#tiers tbody tr").length')) === 4 && (await obs.ev('["board-live","board-next","board-top"].every(i => document.getElementById(i).textContent.trim().length > 0)')));
check('landing: ticker carries the finished ride + the pot', await until(async () => { const t = await obs.ev('document.getElementById("ticker").textContent'); return /finished a test ride/.test(t) && /in the pot/.test(t); }));
check('landing: all-time km counter > 0 after the completed ride', await until(async () => parseFloat(await obs.ev('document.getElementById("hero-km").textContent')) > 0));
check('landing: signed-in CTA opens the lobby', await until(async () => /LOBBY/.test(await obs.ev('document.getElementById("connect").textContent'))));
check('landing: pool = /api/pool', (await obs.ev('document.querySelector("#poolbox .big").textContent')) === (l => `${(l / 1e9).toFixed(l >= 1e9 ? 2 : 3)} SOL`)((await (await fetch(`${BASE}/api/pool`)).json()).split.grand));
await obs.shot('landing-desktop'); await size(obs, 390, 844, true); await sleep(300); await obs.shot('landing-phone');

const p1 = rider.filt(), p2 = obs.filt(); check('no page errors (rider, observer)', !p1.length && !p2.length, [...p1, ...p2].join(' | '));
console.log(`screenshots: ${rider.SHOTS}`);
const code = fails.length ? 1 : 0;   // every finish() schedules a process.exit – give them all the same code so the first one to fire can't hide a failure
rider.finish(code, 300); obs.finish(code, 300); third.finish(code, 300);
