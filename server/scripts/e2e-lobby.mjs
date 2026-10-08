// Click-through of the whole loop FROM THE LOBBY in real headless Chrome (four browsers: a rider, an observer, a wallet with an unpaid legacy order, a ticket holder), screenshots of every tab at desktop and phone width.
// Server (after `npm run landing:build` at the root – / is the Vite build): FREE_RIDE_SECONDS=3 SOL_USD=118 TREASURY_PUBKEY=<any address> PORT=3111 node dist/main.js  (PostgreSQL up + migrated: npm run db:up && npm run prisma:deploy)     then:   BASE=http://localhost:3111 node scripts/e2e-lobby.mjs
// Escrowed pools (dev-only seeds, same DATABASE_URL as the server – or run this script with SEED=1 and that DATABASE_URL, it runs them and ignores "already exists"):
//   node dist/cli/index.js pool:seed --id 1 --tier 1h --status active --min 2 · pool:seed --id 2 --tier 4h --status open --min 10 --sold 7 · promo:create WELCOME --tier 1h --credits 2 · promo:create OPEN4H --tier 4h --pool 2 --credits 1
//   → 1h = a LIVE pool, 4h = an OPEN pool 7/10, 8h = no pool (the legacy pay-per-ride card). `refunding` can't be seeded (open|active only): its card states are unit-tested (landing/test/pools.test.js) and shown by scripts/stub-api.mjs.
// No wallet extension: a keypair signs the challenge and the session cookie is handed to Chrome. Paid payments can't be clicked through (no wallet) – covered by vitest / devnet-pay.mjs.
// PORT = the first of four DevTools ports (default 9341); SHOTS = where the screenshots go (default $TMPDIR/fc-lobby-shots).
import nacl from 'tweetnacl'; import bs58 from 'bs58'; import { execFileSync } from 'node:child_process';
import { launch, sleep } from '../../client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111', CDP = +(process.env.PORT || 9341);
const fails = []; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const post = async (p, b, c) => { const r = await fetch(`${BASE}/api/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(c && { cookie: c }) }, body: JSON.stringify(b) }); return { r, j: await r.json() }; };
const get = async (p, c) => (await fetch(`${BASE}/api/${p}`, { headers: c ? { cookie: c } : {} })).json();
async function wallet() {
  const kp = nacl.sign.keyPair(), address = bs58.encode(kp.publicKey), { j } = await post('auth/nonce', { wallet: address });
  const { r } = await post('auth/verify', { wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) });
  return { address, short: `${address.slice(0, 4)}…${address.slice(-4)}`, cookie: r.headers.get('set-cookie').split(';')[0] };
}
const until = async (fn, ms = 20000) => { for (let i = 0; i <= ms / 250; i++) { const v = await fn(); if (v) return v; await sleep(250); } return false; };   // counts polls, not wall time: a laptop that sleeps mid-run must not time a check out
async function open(h, w, url) { const [n, v] = w.cookie.split('='); await h.send('Network.setCookie', { name: n, value: v, url: BASE, httpOnly: true }); await h.send('Page.navigate', { url }); }
const size = (h, w, hgt, mobile) => h.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile });
const txt = (h, sel) => h.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
const sol = l => `${(l / 1e9).toFixed(l >= 1e9 ? 2 : 3)} SOL`;
// refusals the new checks provoke on purpose (Chrome logs every 4xx fetch as an error): only these URLs, only these statuses
const expected = p => /status of (404|409)/.test(p) && /\/api\/(promo\/redeem|rides)\b/.test(p);
const problems = h => h.filt().filter(p => !expected(p));

if (process.env.SEED === '1') {   // dev-only seeds through the admin CLI (refused in production); "already exists" is fine
  for (const args of [['pool:seed', '--id', '1', '--tier', '1h', '--status', 'active', '--min', '2'], ['pool:seed', '--id', '2', '--tier', '4h', '--status', 'open', '--min', '10', '--sold', '7'], ['promo:create', 'WELCOME', '--tier', '1h', '--credits', '2'], ['promo:create', 'OPEN4H', '--tier', '4h', '--pool', '2', '--credits', '1']]) {
    try { execFileSync('node', ['dist/cli/index.js', ...args], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' }); console.log(`seeded: ${args.join(' ')}`); } catch { console.log(`seed skipped (exists?): ${args.join(' ')}`); }
  }
}
const tiers = await get('tiers'), live1h = tiers.tiers.find(t => t.id === '1h')?.pool, open4h = tiers.tiers.find(t => t.id === '4h')?.pool;
if (live1h?.status !== 'active' || open4h?.status !== 'open' || tiers.tiers.find(t => t.id === '8h')?.pool) { console.error('expected seeded pools: 1h active, 4h open, 8h none – see the header (or SEED=1 with the server\'s DATABASE_URL)'); process.exit(2); }

const A = await wallet(), B = await wallet();
const rider = await launch({ port: CDP, shotsDir: 'fc-lobby-shots', evalProblems: true }), obs = await launch({ port: CDP + 1, shotsDir: 'fc-lobby-shots', evalProblems: true });
await size(rider, 1100, 900, false); await size(obs, 1100, 900, false);

// ── NEW RIDE
await open(rider, A, `${BASE}/lobby.html#new`);
check('lobby renders: one card per shift', await until(async () => (await rider.ev('document.querySelectorAll(".tier").length')) === 4));
check('header shows the wallet, 5 free rides', (await rider.ev('document.getElementById("chip-wallet").textContent')) === A.short && /5 free rides/.test(await rider.ev('document.getElementById("chip-free").textContent')), await rider.ev('document.getElementById("chip-free").textContent'));
const esc = (await get('pools')).pools.reduce((a, p) => a + p.vaultLamports, 0);
check('top box: the escrow across the pools on sale', /IN ESCROW/.test(await txt(rider, '.pool .lbl')) && (await txt(rider, '.pool .big')) === sol(esc), await txt(rider, '.pool .big'));
check('free card: START FREE RIDE', (await rider.ev('document.getElementById("start").textContent')) === 'START FREE RIDE');
// pool cards (1h LIVE, 4h OPEN 7/10)
check('1h card: LIVE chip, price from the pool, "2 / 2 committed"', (await txt(rider, '#tier-1h .st')) === 'LIVE' && (await txt(rider, '#tier-1h .pr')).startsWith(sol(live1h.priceLamports)) && (await txt(rider, '#tier-1h .ptext')).startsWith(`${live1h.sold} / ${live1h.minTickets} committed`), await txt(rider, '#tier-1h .ptext'));
check('4h card: NEEDS n MORE chip, progress bar at sold/min, toGo in words', (await txt(rider, '#tier-4h .st')) === `NEEDS ${open4h.toGo} MORE` && (await rider.ev('document.querySelector("#tier-4h .prog i").style.width')) === `${open4h.progressPct}%` && new RegExp(`needs ${open4h.toGo} more riders? to go live`).test(await txt(rider, '#tier-4h .ptext')), await txt(rider, '#tier-4h .ptext'));
check('4h card: the prep deadline counts down', /goes live if \d+ commit by \d{4}-\d\d-\d\d/.test(await txt(rider, '#tier-4h')) && await until(async () => /\d\d:\d\d:\d\d/.test(await txt(rider, '#tier-4h .pcd'))), await txt(rider, '#tier-4h .pcd'));
check('pool card: escrow, 70/20/10 split, explorer link to the pool account (devnet)', (await txt(rider, '#tier-1h .esc')) === sol(live1h.vaultLamports) && /70% prizes/.test(await txt(rider, '#tier-1h .legend')) && (await rider.ev('document.querySelector("#tier-1h .addrs a").href')) === `https://explorer.solana.com/address/${live1h.address}?cluster=devnet`);
const program = tiers.paymentMode === 'program';   // a server with the pool program sells tickets; without it BUY is SOON (buying itself: scripts/e2e-tickets-stub.mjs)
check(`pool card: no RIDE without a ticket; BUY ${program ? 'live with the price' : 'shown as SOON (no program on this server)'}`, !(await rider.ev('!!document.querySelector("#tier-1h .go")')) && (program
  ? !(await rider.ev('document.querySelector("#tier-1h .buyb").disabled')) && (await txt(rider, '#tier-1h .buyb')) === `BUY 1 TICKET · ${sol(live1h.priceLamports)}`
  : (await rider.ev('document.querySelector("#tier-1h .buyb").disabled')) && /SOON/.test(await txt(rider, '#tier-1h .buyb'))), await txt(rider, '#tier-1h .buyb'));
check('8h card (no pool): the legacy pay-per-ride offer, non-refundable', /PAY \$50/.test(await txt(rider, '#tier-8h .go')) && /Non-refundable/.test(await txt(rider, '#tier-8h')), await txt(rider, '#tier-8h .go'));
await rider.shot('new-desktop');
await rider.ev('document.querySelector("#tier-8h .go").click()');   // no wallet extension here
check('paid click without a wallet: a clear message, no order made', await until(async () => /No Solana wallet/.test(await txt(rider, '#msg-8h'))), await txt(rider, '#msg-8h'));
check('…and no stray order exists', (await get('rides/pending', A.cookie)).ride === null);
await size(rider, 390, 844, true); await sleep(300); await rider.shot('new-phone');
check('phone width: no horizontal page scroll', await rider.ev('document.documentElement.scrollWidth <= innerWidth + 1'), String(await rider.ev('document.documentElement.scrollWidth')));
await size(rider, 1100, 900, false);

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
check('…and the free-ride count dropped to 4', await until(async () => /\b4\/\d+ free rides/.test(await rider.ev('document.getElementById("chip-free").textContent'))));
check('the finished ride left the live feed', await until(async () => { await sleep(5200); return !(await obs.ev('document.getElementById("rides")?.textContent || ""')).includes(A.short); }, 15000));

// ── payment-recovery branch: a wallet with an UNPAID legacy order (8h has no pool) opens the lobby (checkPending → reconcile runs once, against the real RPC)
const C = await wallet(); await post('rides', { tier: '8h' }, C.cookie);
const third = await launch({ port: CDP + 2, shotsDir: 'fc-lobby-shots', evalProblems: true }); await size(third, 1100, 900, false);
await open(third, C, `${BASE}/lobby.html#new`);
check('lobby with an unpaid order: cards render, START enabled', await until(async () => (await third.ev('document.querySelectorAll(".tier").length')) === 4 && (await third.ev('document.getElementById("start").disabled')) === false));
check('…the recovery check finishes (note cleared, or "Could not check…" if the RPC is down)', await until(async () => { const t = await third.ev('document.getElementById("pendingbox").textContent'); return t === '' || /Could not check/.test(t); }, 30000), JSON.stringify(await third.ev('document.getElementById("pendingbox").textContent')));
check('…and no page errors on that path', problems(third).length === 0, problems(third).join(' | '));

// ── TICKETS: promo → RIDE with a ticket → the game; the 409s read as sentences (fourth browser, wallet D)
const D = await wallet(), tix = await launch({ port: CDP + 3, shotsDir: 'fc-lobby-shots', evalProblems: true }); await size(tix, 1100, 900, false);
await open(tix, D, `${BASE}/lobby.html#new`); await until(async () => (await tix.ev('document.querySelectorAll(".tier").length')) === 4);
const redeem = async code => { await tix.ev(`document.getElementById("promo-code").value = ${JSON.stringify(code)}; document.getElementById("promo-go").click()`); await until(async () => !/Redeeming/.test(await txt(tix, '#promo-msg')) && (await txt(tix, '#promo-msg')) !== ''); return txt(tix, '#promo-msg'); };
check('promo: an unknown code reads "Unknown promo code"', /Unknown promo code/.test(await redeem('NOPE-NOPE')), await txt(tix, '#promo-msg'));
check('promo: WELCOME (any case) → +2 tickets, balance and cap shown', /^\+2 tickets \(WELCOME\) in pool #\d+ · you hold 2 · cap \d+/.test(await redeem('welcome')), await txt(tix, '#promo-msg'));
check('…the 1h card now offers RIDE (2 left) and counts your tickets', await until(async () => (await txt(tix, '#tier-1h .go')) === 'RIDE (2 left)') && /your tickets: 2/.test(await txt(tix, '#tier-1h .mine')), await txt(tix, '#tier-1h .go'));
check('promo: a second WELCOME is refused with the reason', /already redeemed/.test(await redeem('WELCOME')), await txt(tix, '#promo-msg'));
check('promo: OPEN4H puts a ticket into the OPEN pool → WAITING FOR n MORE RIDERS (disabled)', /^\+1 ticket \(OPEN4H\)/.test(await redeem('OPEN4H')) && await until(async () => /^WAITING FOR \d+ MORE RIDERS?$/.test(await txt(tix, '#tier-4h .go'))) && await tix.ev('document.querySelector("#tier-4h .go").disabled'), await txt(tix, '#tier-4h .go'));
const nl = await post('rides', { tier: '4h' }, D.cookie);
check('API: a ride on the open pool is 409 pool_not_live (the lobby never offers it)', nl.r.status === 409 && nl.j.code === 'pool_not_live', JSON.stringify(nl.j));
await tix.shot('tickets-desktop'); await size(tix, 390, 844, true); await sleep(300); await tix.shot('tickets-phone'); await size(tix, 1100, 900, false);
await tix.ev('document.querySelector("#tier-1h .go").click()');
check('RIDE spends a ticket and opens play.html?ride=… (no payment step)', await until(async () => /\/play\.html\?ride=/.test(await tix.ev('location.pathname + location.search'))));
const r1 = (await tix.ev('location.search')).split('ride=')[1];
check('…the game boots with the server\'s 1h ride (from the pool)', await until(async () => await tix.ev('!!window.__game')) && await (async () => { const r = (await get('rides/pending', D.cookie)).ride; return r?.id === r1 && r.tier === '1h' && r.poolId === live1h.id && r.status === 'created'; })());
const finishOob = async id => { await post(`rides/${id}/start`, {}, D.cookie); await post(`rides/${id}/end`, { outcome: 'failed', s: 0, t: 0, reason: 'e2e' }, D.cookie); };
await finishOob(r1);                                              // out of band: that ride is over, one ticket left
await open(tix, D, `${BASE}/lobby.html#new`);
check('back in the lobby: RIDE (1 left)', await until(async () => (await txt(tix, '#tier-1h .go')) === 'RIDE (1 left)'), await txt(tix, '#tier-1h .go'));
const r2 = await post('rides', { tier: '1h' }, D.cookie); await finishOob(r2.j.id);   // out of band, behind the page's back: the last ticket is spent
await tix.ev('document.querySelector("#tier-1h .go").click()');   // the page still says 1 left
check('409 no_tickets on a stale page reads as a sentence (and the card refreshes)', await until(async () => /No 1 HOUR tickets left – buy one or redeem a promo code/.test(await txt(tix, '#msg-1h'))) && await until(async () => !(await tix.ev('!!document.querySelector("#tier-1h .go")'))), await txt(tix, '#msg-1h'));
await tix.ev('location.hash = "#profile"');
check('PROFILE: tickets per pool (1h spent, 4h waiting) + the grant audit trail', await until(async () => /OPEN/.test(await txt(tix, '.tix')) && /ACTIVE/.test(await txt(tix, '.tix'))) && await until(async () => { const h = [...await tix.ev('[...document.querySelectorAll(".hist")].map(n => n.textContent)')].join('|'); return /promo code WELCOME\+2/.test(h) && /ride.*-1/.test(h); }), await txt(tix, '.tix'));
await tix.shot('profile-tickets-desktop'); await size(tix, 390, 844, true); await sleep(300); await tix.shot('profile-tickets-phone'); await size(tix, 1100, 900, false);
check('…and no unexpected page errors (ticket holder)', problems(tix).length === 0, problems(tix).join(' | '));

// ── PROFILE
await rider.ev('location.hash = "#profile"');
check('PROFILE: stats + achievements unlocked + the ride in history', await until(async () => (await rider.ev('document.querySelectorAll(".a").length')) === 7));
const ach = await rider.ev('[...document.querySelectorAll(".a")].map(a => (a.classList.contains("lock") ? "-" : "+") + a.querySelector(".nm").textContent).join("|")');
check('First Mile + Shift Complete unlocked, Top 20 locked', /\+First Mile/.test(ach) && /\+Shift Complete/.test(ach) && /-Top 20/.test(ach), ach);
check('history lists the ride as COMPLETED', /COMPLETED/.test(await rider.ev('[...document.querySelectorAll(".hist")].map(n => n.textContent).join("|")')));
check('a wallet without tickets: "No tickets yet"', /No tickets yet/.test(await rider.ev('document.getElementById("view").textContent')));
await rider.shot('profile-desktop'); await size(rider, 390, 844, true); await sleep(300); await rider.shot('profile-phone'); await size(rider, 1100, 900, false);

// ── LEADERBOARD (free board) + reload keeps the tab
await rider.ev('location.hash = "#board"'); await until(async () => (await rider.ev('document.querySelectorAll(".seg button").length')) === 3);
await rider.ev('[...document.querySelectorAll(".seg button")][2].click()');
check('LEADERBOARD › FREE: the rider is on the board and highlighted (the database persists between runs, so not necessarily #1)', await until(async () => /^\d+$/.test(await rider.ev('document.querySelector("tr.me .rk")?.textContent || ""'))));
await rider.shot('board-desktop'); await size(rider, 390, 844, true); await sleep(300); await rider.shot('board-phone'); await size(rider, 1100, 900, false);
await rider.send('Page.reload'); check('reload keeps the tab (#board)', await until(async () => (await rider.ev('document.querySelector(".tabs a.on")?.dataset.tab')) === 'board'));
await obs.send('Page.navigate', { url: `${BASE}/lobby.html#new` }); await sleep(1500);

// ── LANDING (signed in: no forced redirect, CTA becomes the lobby link; public numbers agree with the API)
await size(obs, 1100, 900, false); await open(obs, B, `${BASE}/`);
check('landing: stays on / and shows the pool', await until(async () => (await obs.ev('location.pathname')) === '/' && /SOL$/.test(await obs.ev('document.querySelector("#poolbox .big")?.textContent || ""'))));
check('landing: the hero stat is the escrow across the pools', await until(async () => /^IN ESCROW · \d+ POOLS?$/.test(await txt(obs, '#hero-pot-lbl'))), await txt(obs, '#hero-pot-lbl'));
check('landing: 4 shifts + three boards rendered', await until(async () => (await obs.ev('document.querySelectorAll("#tiers tbody tr").length')) === 4 && (await obs.ev('["board-live","board-next","board-top"].every(i => document.getElementById(i).textContent.trim().length > 0)'))));
check('landing: ticker carries the finished ride + the pot', await until(async () => { const t = await obs.ev('document.getElementById("ticker").textContent'); return /finished a test ride/.test(t) && /in the pot/.test(t); }));
check('landing: all-time km counter > 0 after the completed ride', await until(async () => parseFloat(await obs.ev('document.getElementById("hero-km").textContent')) > 0));
check('landing: signed-in CTA opens the lobby', await until(async () => /LOBBY/.test(await obs.ev('document.getElementById("connect").textContent'))));
check('landing: pool = /api/pool', (await obs.ev('document.querySelector("#poolbox .big").textContent')) === (l => `${(l / 1e9).toFixed(l >= 1e9 ? 2 : 3)} SOL`)((await get('pool')).split.grand));
const pools = (await get('pools')).pools;
check('landing: the live pools board = /api/pools (one row each, "sold / min committed", escrow, explorer link)', await until(async () => (await obs.ev('document.querySelectorAll("#pools .prow").length')) === pools.length) && (await txt(obs, '#pools')).includes(`${open4h.sold} / ${open4h.minTickets} committed`) && (await obs.ev(`[...document.querySelectorAll("#pools a")].some(a => a.href === "https://explorer.solana.com/address/${open4h.address}?cluster=devnet")`)), (await txt(obs, '#pools')).slice(0, 160));
check('landing: the escrow block links the explainer', await obs.ev('[...document.querySelectorAll("#economy a")].some(a => /\\/escrow\\/$/.test(a.href))'));
const ex = await fetch(`${BASE}/escrow/`); check('the explainer page is served at /escrow/', ex.ok && /Pool escrow/.test(await ex.text()));
const toPools = async () => { await obs.ev('document.querySelectorAll(".rv").forEach(n => n.classList.add("in")); document.getElementById("pools").scrollIntoView({ behavior: "instant", block: "center" })'); await sleep(1200); };   // .rv fades in on scroll
await obs.shot('landing-desktop'); await toPools(); await obs.shot('landing-pools-desktop');
await obs.ev('scrollTo({ top: 0, behavior: "instant" })'); await size(obs, 390, 844, true); await sleep(300); await obs.shot('landing-phone'); await toPools(); await obs.shot('landing-pools-phone');

const p1 = problems(rider), p2 = problems(obs); check('no page errors (rider, observer)', !p1.length && !p2.length, [...p1, ...p2].join(' | '));
console.log(`screenshots: ${rider.SHOTS}`);
const code = fails.length ? 1 : 0;   // every finish() schedules a process.exit – give them all the same code so the first one to fire can't hide a failure
rider.finish(code, 300); obs.finish(code, 300); third.finish(code, 300); tix.finish(code, 300);
