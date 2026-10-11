// Click-through of the whole loop FROM THE LOBBY in real headless Chrome (four browsers: a rider, an observer, another signed-in lobby, a ticket holder), screenshots of every tab at desktop and phone width.
// Server (after `npm run landing:build` at the root – / is the Vite build): FREE_RIDE_SECONDS=3 SOL_USD=118 TREASURY_PUBKEY=<any address> PORT=3111 node dist/main.js  (PostgreSQL up + migrated: npm run db:up && npm run prisma:deploy)     then:   BASE=http://localhost:3111 node scripts/e2e-lobby.mjs
// Escrowed pools (dev-only seeds, same DATABASE_URL as the server – or run this script with SEED=1 and that DATABASE_URL, it runs them and ignores "already exists"):
//   node dist/cli/index.js pool:seed --id 1 --tier 1h --status active --min 2 · pool:seed --id 2 --tier 4h --status open --min 10 --sold 7 · promo:create WELCOME --tier 1h --credits 2 · promo:create OPEN4H --tier 4h --pool 2 --credits 1 · promo:create THREE --free-rides 3 · promo:create GOLDWHEEL --cosmetic wheel:gold --desc "A golden wheel" · promo:create BLUEPAINT --cosmetic truck_color:blue · promo:create PINKDICE --cosmetic dice:pink · promo:create RACEBOX --cosmetic gearbox:racing
//   → 1h = a LIVE pool, 4h = an OPEN pool 7/10, 8h = no pool (SOON, not for sale). `refunding` can't be seeded (open|active only): its card states are unit-tested (landing/test/pools.test.js) and shown by scripts/stub-api.mjs.
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
  for (const args of [['pool:seed', '--id', '1', '--tier', '1h', '--status', 'active', '--min', '2'], ['pool:seed', '--id', '2', '--tier', '4h', '--status', 'open', '--min', '10', '--sold', '7'], ['promo:create', 'WELCOME', '--tier', '1h', '--credits', '2'], ['promo:create', 'OPEN4H', '--tier', '4h', '--pool', '2', '--credits', '1'], ['promo:create', 'THREE', '--free-rides', '3'], ['promo:create', 'GOLDWHEEL', '--cosmetic', 'wheel:gold', '--desc', 'A golden wheel'], ['promo:create', 'BLUEPAINT', '--cosmetic', 'truck_color:blue'], ['promo:create', 'PINKDICE', '--cosmetic', 'dice:pink'], ['promo:create', 'RACEBOX', '--cosmetic', 'gearbox:racing']]) {
    try { execFileSync('node', ['dist/cli/index.js', ...args], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' }); console.log(`seeded: ${args.join(' ')}`); } catch { console.log(`seed skipped (exists?): ${args.join(' ')}`); }
  }
}
const tiers = await get('tiers'), live1h = tiers.tiers.find(t => t.id === '1h')?.pool, open4h = tiers.tiers.find(t => t.id === '4h')?.pool, soon8h = tiers.tiers.find(t => t.id === '8h');
if (live1h?.status !== 'active' || open4h?.status !== 'open' || soon8h?.pool || soon8h?.onSale !== false) { console.error('expected seeded pools: 1h active, 4h open, 8h none and not on sale – see the header (or SEED=1 with the server\'s DATABASE_URL)'); process.exit(2); }

const A = await wallet(), B = await wallet();
const rider = await launch({ port: CDP, shotsDir: 'fc-lobby-shots', evalProblems: true }), obs = await launch({ port: CDP + 1, shotsDir: 'fc-lobby-shots', evalProblems: true });
await size(rider, 1100, 900, false); await size(obs, 1100, 900, false);

// ── NEW RIDE
await open(rider, A, `${BASE}/lobby.html#new`);
check('lobby renders: one card per shift', await until(async () => (await rider.ev('document.querySelectorAll(".tier:not(.result)").length')) === 4));
check('header shows the wallet, 10/5 free rides', (await rider.ev('document.getElementById("chip-wallet").textContent')) === A.short && /10\/5 free rides/.test(await rider.ev('document.getElementById("chip-free").textContent')), await rider.ev('document.getElementById("chip-free").textContent'));
const esc = (await get('pools')).pools.reduce((a, p) => a + p.vaultLamports, 0);
check('top box: the escrow across the pools on sale', /IN ESCROW/.test(await txt(rider, '.pool .lbl')) && (await txt(rider, '.pool .big')) === sol(esc), await txt(rider, '.pool .big'));
check('free card: START FREE RIDE', (await rider.ev('document.getElementById("start").textContent')) === 'START FREE RIDE');
// pool cards (1h LIVE, 4h OPEN 7/10)
check('1h card: LIVE chip, price from the pool, "2 / 2 committed"', (await txt(rider, '#tier-1h .st')) === 'LIVE' && (await txt(rider, '#tier-1h .pr')).startsWith(sol(live1h.priceLamports)) && (await txt(rider, '#tier-1h .ptext')).startsWith(`${live1h.sold} / ${live1h.minTickets} committed`), await txt(rider, '#tier-1h .ptext'));
check('4h card: NEEDS n MORE chip, progress bar at sold/min, toGo in words', (await txt(rider, '#tier-4h .st')) === `NEEDS ${open4h.toGo} MORE` && (await rider.ev('document.querySelector("#tier-4h .prog i").style.width')) === `${open4h.progressPct}%` && new RegExp(`needs ${open4h.toGo} more riders? to go live`).test(await txt(rider, '#tier-4h .ptext')), await txt(rider, '#tier-4h .ptext'));
check('1h card: the phase line (ON SALE · n d left) and the series rule from the tier schedule (24 h sale · 2 h more riding · 48 h review)', /^ON SALE · \d+ d left$/.test(await txt(rider, '#tier-1h .phase')) && (await txt(rider, '#tier-1h .sched')) === 'a new pool every 24 h · sales close after 24 h · rides count 2 h more · 48 h review before prizes', `${await txt(rider, '#tier-1h .phase')} | ${await txt(rider, '#tier-1h .sched')}`);
check('4h card: the prep deadline counts down', /goes live if \d+ commit by \d{4}-\d\d-\d\d/.test(await txt(rider, '#tier-4h')) && await until(async () => /\d\d:\d\d:\d\d/.test(await txt(rider, '#tier-4h .pcd'))), await txt(rider, '#tier-4h .pcd'));
check('pool card: escrow, 70/20/10 split, explorer link to the pool account (devnet)', (await txt(rider, '#tier-1h .esc')) === sol(live1h.vaultLamports) && /70% prizes/.test(await txt(rider, '#tier-1h .legend')) && (await rider.ev('document.querySelector("#tier-1h .addrs a").href')) === `https://explorer.solana.com/address/${live1h.address}?cluster=devnet`);
const program = tiers.paymentMode === 'program';   // a server with the pool program sells tickets; without it BUY is SOON (buying itself: scripts/e2e-tickets-stub.mjs)
check(`pool card: no RIDE without a ticket; BUY ${program ? 'live with the price' : 'shown as SOON (no program on this server)'}`, !(await rider.ev('!!document.querySelector("#tier-1h .go")')) && (program
  ? !(await rider.ev('document.querySelector("#tier-1h .buyb").disabled')) && (await txt(rider, '#tier-1h .buyb')) === `BUY 1 TICKET · ${sol(live1h.priceLamports)}`
  : (await rider.ev('document.querySelector("#tier-1h .buyb").disabled')) && /SOON/.test(await txt(rider, '#tier-1h .buyb'))), await txt(rider, '#tier-1h .buyb'));
check('8h card (no pool): SOON, button disabled, planned price, no pay-per-ride offer', (await txt(rider, '#tier-8h .st')) === 'SOON' && (await txt(rider, '#tier-8h .go')) === 'SOON' && (await rider.ev('document.querySelector("#tier-8h .go").disabled')) === true && /\$50/.test(await txt(rider, '#tier-8h')) && !/PAY|Non-refundable|NO POOL/.test(await txt(rider, '#tier-8h')), await txt(rider, '#tier-8h'));
await rider.shot('new-desktop');
await rider.ev('document.querySelector("#tier-8h .go").click()');   // disabled: it must not ask for a wallet or open an order
check('the soon button does nothing: no message, no order', (await txt(rider, '#msg-8h')) === '' && (await get('rides/pending', A.cookie)).ride === null, await txt(rider, '#msg-8h'));
await size(rider, 390, 844, true); await sleep(300); await rider.shot('new-phone');
check('phone width: no horizontal page scroll', await rider.ev('document.documentElement.scrollWidth <= innerWidth + 1'), String(await rider.ev('document.documentElement.scrollWidth')));
await size(rider, 1100, 900, false);

// ── START FREE RIDE → game
check('free card: TUTORIAL is on for a new rider, ASSIST is off (both checkboxes are there)', (await rider.ev('document.getElementById("opt-tutorial")?.checked')) === true && (await rider.ev('document.getElementById("opt-assist")?.checked')) === false);
await rider.ev('document.getElementById("opt-assist").click()'); await sleep(1300);   // a repaint (the 1 s tick) must keep the choice
check('the checkbox choice survives a repaint', (await rider.ev('document.getElementById("opt-assist").checked')) === true && (await rider.ev('document.getElementById("opt-tutorial").checked')) === true);
// the LEVEL picker (GET /api/tiers → levels; FREE_RIDE_SECONDS=3 → 3 s / 5 s / 15 s): EASY by default, HARD locks ASSIST off, the ride is free-3b
check('free card: a LEVEL picker EASY / MEDIUM / HARD, each a different country, EASY picked', (await rider.ev('[...document.querySelectorAll(".levels .lv b")].map(b => b.textContent).join(",")')) === 'EASY,MEDIUM,HARD' && (await rider.ev('[...document.querySelectorAll(".levels .cty")].map(n => n.textContent).join("|")')) === 'Australia|USA|Austria · Italy' && (await rider.ev('document.getElementById("level-1").checked')) === true && /EASY/.test(await txt(rider, '.lv.on b')) && /Stuart Highway/.test(await txt(rider, '.lv.on')) && /side-wind/.test(await txt(rider, '.lv.on')) && /0:03/.test(await txt(rider, '.lv.on')) && (await rider.ev('document.getElementById("free-shift") == null')) === true, await txt(rider, '#tier-free .levels') + ' | ' + await txt(rider, '.lv.on'));
await rider.ev('document.getElementById("level-3").click()'); await sleep(300);
check('HARD picked: the chip says so, TUTORIAL and ASSIST are unchecked + disabled, and each block keeps its own text', /HARD/.test(await txt(rider, '.lv.on b')) && /Brenner Pass/.test(await txt(rider, '.lv.on')) && /0:15/.test(await txt(rider, '.lv.on')) && (await rider.ev('document.getElementById("opt-tutorial").checked')) === false && (await rider.ev('document.getElementById("opt-tutorial").disabled')) === true && (await rider.ev('document.getElementById("opt-assist").checked')) === false && (await rider.ev('document.getElementById("opt-assist").disabled')) === true && /ignition/.test(await txt(rider, 'label[for="opt-tutorial"]')) && /twice as long/.test(await txt(rider, 'label[for="opt-assist"]')) && !/no assist on HARD/i.test(await txt(rider, '#tier-free .guide')), await txt(rider, '.lv.on') + ' | ' + await txt(rider, '#tier-free .guide'));
await sleep(1300);
check('…and the pick survives a repaint', (await rider.ev('document.getElementById("level-3").checked')) === true && (await rider.ev('document.getElementById("opt-tutorial").disabled')) === true && (await rider.ev('document.getElementById("opt-assist").disabled')) === true);
await rider.shot('free-levels-hard');
await rider.ev('document.getElementById("start").click()');
check('START at HARD opens a ride on trip free-3b – 15 s, no tutorial, no assist, and the world is Brenner', await until(async () => await rider.ev('!!window.__game?.online?.ride && __game.online.ride.trip === "free-3b" && __game.online.ride.level === 3 && __game.online.ride.route === "brenner" && __game.weather.ambient === 3 && __game.weather.snow === 0.25 && /Brenner Pass/.test(document.getElementById("panel")?.textContent || "") && __game.online.ride.minSeconds === 15 && __game.online.ride.assist === false && __game.online.ride.tutorial === false && __game.trip.id === "free-3b"')), await rider.ev('JSON.stringify({ ride: window.__game?.online?.ride ?? null, weather: window.__game?.weather ?? null })'));
const hardId = await rider.ev('__game.online.ride.id');
await open(rider, A, `${BASE}/lobby.html`); await until(async () => !!(await rider.ev('document.getElementById("level-3")')));
check('back in the lobby: HARD is remembered', (await rider.ev('document.getElementById("level-3").checked')) === true);
await rider.ev('document.getElementById("level-1").click()'); await sleep(300);
check('EASY again: TUTORIAL and ASSIST are back on (the remembered choices) and enabled', (await rider.ev('document.getElementById("opt-tutorial").checked')) === true && (await rider.ev('document.getElementById("opt-tutorial").disabled')) === false && (await rider.ev('document.getElementById("opt-assist").checked')) === true && (await rider.ev('document.getElementById("opt-assist").disabled')) === false);
await rider.ev('document.getElementById("start").click()');
check('…START re-chooses the SAME ready ride at EASY (one credit, free-1c) and the world is Australia', await until(async () => await rider.ev(`!!window.__game?.online?.ride && __game.online.ride.id === ${JSON.stringify(hardId)} && __game.online.ride.trip === "free-1c" && __game.online.ride.level === 1 && __game.online.ride.route === "stuart" && __game.weather.ambient === 34 && /Stuart Highway/.test(document.getElementById("panel")?.textContent || "")`)), await rider.ev('JSON.stringify({ ride: window.__game?.online?.ride ?? null, weather: window.__game?.weather ?? null })'));
check('START FREE RIDE opens play.html?ride=…', await until(async () => /\/play\.html\?ride=/.test(await rider.ev('location.pathname + location.search'))));
check('game booted with the server ride', await until(async () => await rider.ev('!!window.__game && __game.CFG.RIDE_MIN_SECONDS === 3')));
check('the game gets the ride\'s helpers from the server (tutorial + assist)', await rider.ev('__game.guide.tutorial === true && __game.guide.assist === true && __game.online.ride.tutorial === true'));
check('the game applies the SERVER\'s world: the ride\'s route + start hour, and no function to change them is left on the page (no picker cards, no wallet rows)', await rider.ev('(() => { const g = __game, r = g.online.ride; return r.route === "stuart" && g.weather.ambient === 34 && typeof r.startHour === "number" && typeof g.selectTheme === "undefined" && typeof g.setNight === "undefined" && typeof g.setPhase === "undefined" && typeof g.setClock === "undefined" && Math.abs(g.dn.t - r.startHour) < 0.05 && !document.querySelector(".routes, .tod, #topup") && !/FRT/.test(document.getElementById("panel").textContent) && /Route \\(set by the server\\)/.test(document.getElementById("panel").textContent) && /Stuart Highway/.test(document.getElementById("panel").textContent); })()'), await rider.ev('JSON.stringify({ r: __game.online.ride.route, h: __game.online.ride.startHour, t: __game.dn.t, ambient: __game.weather.ambient })'));
check('ordered, not started: the tutorial is not passed yet', (await get('me', A.cookie)).tutorialPassed === false);
await rider.ev('document.getElementById("go").click()'); await sleep(800);
check('the tutorial dialog is up over the gameplay (step 1 of 8, the key highlighted)', await until(async () => await rider.ev('(() => { const d = document.getElementById("tutorial"); return !!d && !d.hidden && d.textContent.includes("1/8") && __game.guide.tips.some(t => t.id === "key-on"); })()')), await rider.ev('JSON.stringify({ mode: __game.st.mode, tips: __game.guide.tips, hidden: document.getElementById("tutorial")?.hidden })'));
check('starting the ride with the tutorial on marked it PASSED (the lobby then leaves it off)', await until(async () => (await get('me', A.cookie)).tutorialPassed === true));
await rider.ev('__game.guide.hold = false');   // the tutorial would hold the free run\'s finish line – this script drives the ride to its end
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
// the distance was set directly (no recording of a real drive), so the recording check rejects it – this script is about the lobby; e2e-browser.mjs covers VERIFIED
check('server verdict COMPLETED + the recording check on the result screen', await until(async () => /^COMPLETED · (VERIFIED|FLAGGED|REJECTED)/.test(await rider.ev('document.getElementById("verdict")?.textContent || ""'))), await rider.ev('document.getElementById("verdict")?.textContent || ""'));
await rider.ev('document.getElementById("lobby").click()');
check('BACK TO LOBBY returns to the lobby', await until(async () => (await rider.ev('location.pathname')) === '/lobby.html'));
check('…and the free-ride count dropped to 9/5', await until(async () => /9\/5 free rides/.test(await rider.ev('document.getElementById("chip-free").textContent'))));
check('the finished ride left the live feed', await until(async () => { await sleep(5200); return !(await obs.ev('document.getElementById("rides")?.textContent || ""')).includes(A.short); }, 15000));

// ── another signed-in lobby. 8h is not on sale and 1h/4h have pools, so this seed has no legacy order to recover.
const C = await wallet();
const third = await launch({ port: CDP + 2, shotsDir: 'fc-lobby-shots', evalProblems: true }); await size(third, 1100, 900, false);
await open(third, C, `${BASE}/lobby.html#new`);
check('another wallet: four cards, START enabled, no unpaid order', await until(async () => (await third.ev('document.querySelectorAll(".tier:not(.result)").length')) === 4 && (await third.ev('document.getElementById("start").disabled')) === false) && (await get('rides/pending', C.cookie)).ride === null);
check('…the pending box stays empty', await until(async () => (await third.ev('document.getElementById("pendingbox").textContent')) === '', 30000), JSON.stringify(await third.ev('document.getElementById("pendingbox").textContent')));
check('…and no page errors on that path', problems(third).length === 0, problems(third).join(' | '));

// ── TICKETS: promo → RIDE with a ticket → the game; the 409s read as sentences (fourth browser, wallet D)
const D = await wallet(), tix = await launch({ port: CDP + 3, shotsDir: 'fc-lobby-shots', evalProblems: true }); await size(tix, 1100, 900, false);
await open(tix, D, `${BASE}/lobby.html#new`); await until(async () => (await tix.ev('document.querySelectorAll(".tier:not(.result)").length')) === 4);
const redeem = async code => { await tix.ev(`document.getElementById("promo-code").value = ${JSON.stringify(code)}; document.getElementById("promo-go").click()`); await until(async () => !/Redeeming/.test(await txt(tix, '#promo-msg')) && (await txt(tix, '#promo-msg')) !== ''); return txt(tix, '#promo-msg'); };
check('promo: an unknown code reads "Unknown promo code"', /Unknown promo code/.test(await redeem('NOPE-NOPE')), await txt(tix, '#promo-msg'));
check('promo: WELCOME (any case) → +2 tickets, balance and cap shown', /^\+2 tickets \(WELCOME\) in pool #\d+ · you hold 2 · cap \d+/.test(await redeem('welcome')), await txt(tix, '#promo-msg'));
check('…the 1h card now offers RIDE (2 left) and counts your tickets', await until(async () => (await txt(tix, '#tier-1h .go')) === 'RIDE (2 left)') && /your tickets: 2/.test(await txt(tix, '#tier-1h .mine')), await txt(tix, '#tier-1h .go'));
check('promo: a second WELCOME is refused with the reason', /already redeemed/.test(await redeem('WELCOME')), await txt(tix, '#promo-msg'));
check('promo: OPEN4H puts a ticket into the OPEN pool → WAITING FOR n MORE RIDERS (disabled)', /^\+1 ticket \(OPEN4H\)/.test(await redeem('OPEN4H')) && await until(async () => /^WAITING FOR \d+ MORE RIDERS?$/.test(await txt(tix, '#tier-4h .go'))) && await tix.ev('document.querySelector("#tier-4h .go").disabled'), await txt(tix, '#tier-4h .go'));
await tix.ev('document.querySelector("#tier-1h .go").click()');
check('a paid RIDE with the boxes off stays in the lobby and opens the profile offer', await until(async () => (await tix.ev('location.hash')) === '#profile' && !/play\.html/.test(await tix.ev('location.pathname')) && (await tix.ev('!!document.getElementById("agree-age") && !!document.getElementById("agree-loss")'))));
await tix.ev('document.getElementById("agree-age").click()');
check('the age box stays on after the server saves it', await until(async () => await tix.ev('document.getElementById("agree-age").checked && !document.getElementById("agree-age").disabled')));
await tix.ev('document.getElementById("agree-loss").click()');
check('the loss box stays on and locks after the server saves it', await until(async () => await tix.ev('document.getElementById("agree-loss").checked && document.getElementById("agree-loss").disabled && document.getElementById("agree-age").checked')));
await tix.ev('location.hash = "#new"');
check('back on NEW RIDE the cards are there', await until(async () => (await tix.ev('document.querySelectorAll(".tier").length')) === 4));
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
check('BEFORE A PAID SHIFT is gone once accepted and left', await until(async () => !(await tix.ev('!!document.getElementById("offer")'))));
check('PROFILE: tickets per pool (1h spent, 4h waiting) + the grant audit trail', await until(async () => /OPEN/.test(await txt(tix, '.tix')) && /ACTIVE/.test(await txt(tix, '.tix'))) && await until(async () => { const h = [...await tix.ev('[...document.querySelectorAll(".hist")].map(n => n.textContent)')].join('|'); return /promo code WELCOME\+2/.test(h) && /ride.*-1/.test(h); }), await txt(tix, '.tix'));
await tix.shot('profile-tickets-desktop'); await size(tix, 390, 844, true); await sleep(300); await tix.shot('profile-tickets-phone'); await size(tix, 1100, 900, false);
check('…and no unexpected page errors (ticket holder)', problems(tix).length === 0, problems(tix).join(' | '));

// ── PROFILE
await rider.ev('location.hash = "#profile"');
check('PROFILE: stats + achievements unlocked + the ride in history', await until(async () => (await rider.ev('document.querySelectorAll(".a").length')) === 11));
check('PROFILE: the ride in history carries its recording verdict', /COMPLETED · (VERIFIED|FLAGGED|REJECTED)/.test(await rider.ev('document.querySelector(".hist .hrow")?.textContent || ""')), await rider.ev('document.querySelector(".hist .hrow")?.textContent || ""'));
const ach = await rider.ev('[...document.querySelectorAll(".a")].map(a => (a.classList.contains("lock") ? "-" : "+") + a.querySelector(".nm").textContent).join("|")');
// the drive above sets the distance directly, so its recording is REJECTED (line ~106); with the verdict enforced (this server's default) a rejected recording
// earns its ride no badge (achievements.ts badgeRejected) – only First Mile (a started ride) – while a verified / flagged one earns them
const rejected = /COMPLETED · REJECTED/.test(await rider.ev('document.querySelector(".hist .hrow")?.textContent || ""'));
check(rejected ? 'First Mile unlocked; the REJECTED drive earns no Shift Complete (enforced verdict); Top 20 locked' : 'First Mile + Shift Complete unlocked, Top 20 locked',
  /\+First Mile/.test(ach) && (rejected ? /-Shift Complete/ : /\+Shift Complete/).test(ach) && /-Top 20/.test(ach), ach);
check(rejected ? 'the rejected EASY run clears no level: Learner’s Permit, Crossroads, Long Haul locked' : 'the EASY free run cleared: Learner’s Permit unlocked, Crossroads + Long Haul locked',
  (rejected ? /-Learner’s Permit/ : /\+Learner’s Permit/).test(ach) && /-Crossroads/.test(ach) && /-Long Haul/.test(ach), ach);
check('history lists the ride as COMPLETED', /COMPLETED/.test(await rider.ev('[...document.querySelectorAll(".hist")].map(n => n.textContent).join("|")')));
check('a wallet without tickets: "No tickets yet"', /No tickets yet/.test(await rider.ev('document.getElementById("view").textContent')));
await rider.shot('profile-desktop'); await size(rider, 390, 844, true); await sleep(300); await rider.shot('profile-phone'); await size(rider, 1100, 900, false);

// ── LEADERBOARD (free board) + reload keeps the tab
await rider.ev('location.hash = "#board"');
check('LEADERBOARD opens on FREE RIDES (THIS ROUND and ALL TIME are unavailable): EASY / MEDIUM / HARD, HARD by default', await until(async () => (await txt(rider, '#board-levels')) === 'EASYMEDIUMHARD' && (await txt(rider, '#board-levels .on')) === 'HARD' && (await rider.ev('document.querySelector("[data-board=free]")?.classList.contains("on") && document.querySelector("[data-board=round]")?.disabled && document.querySelector("[data-board=all]")?.disabled'))), await txt(rider, '#board-levels'));
await rider.ev('document.querySelector("#board-levels button").click()');   // the rider drove EASY – its own board
check('…EASY picked: the board says so', await until(async () => (await txt(rider, '#board-levels .on')) === 'EASY' && /on EASY/.test(await txt(rider, '#view'))), await txt(rider, '#view'));
check('LEADERBOARD › FREE: the rider is on the board and highlighted (the database persists between runs, so not necessarily #1)', await until(async () => /^\d+$/.test(await rider.ev('document.querySelector("tr.me .rk")?.textContent || ""'))));
await rider.shot('board-desktop'); await size(rider, 390, 844, true); await sleep(300); await rider.shot('board-phone'); await size(rider, 1100, 900, false);
await rider.send('Page.reload'); check('reload keeps the tab (#board)', await until(async () => (await rider.ev('document.querySelector(".tabs a.on")?.dataset.tab')) === 'board'));
await obs.send('Page.navigate', { url: `${BASE}/lobby.html#new` }); await sleep(1500);

// ── PROMO: free rides above the cap, a cosmetic unlocked + worn, the wardrobe, an invite link that only pre-fills (fresh wallet, the observer's browser)
const P = await wallet(); await size(obs, 1100, 900, false);
await open(obs, P, `${BASE}/lobby.html#new`);
check('PROMO: the code field lives in the header, on the NEW RIDE tab too', await until(async () => (await obs.ev('!!document.getElementById("promo-code") && !!document.getElementById("promo-go") && location.hash !== "#promo"')) === true));
await obs.ev('location.hash = "#promo"');
check('PROMO tab: the form, a link to the garage, no codes yet', await until(async () => /Parts you unlock are waiting in your garage/.test(await txt(obs, '#view')) && /No codes redeemed yet/.test(await txt(obs, '#my-codes'))));
const promoGo = async code => { await obs.ev(`document.getElementById("promo-code").value = ${JSON.stringify(code)}; document.getElementById("promo-go").click()`); await until(async () => !/Redeeming/.test(await txt(obs, '#promo-msg')) && (await txt(obs, '#promo-msg')) !== ''); return txt(obs, '#promo-msg'); };
check('PROMO: THREE → +3 free rides, the chip shows 13/5 (above the daily cap)', /^\+3 free rides \(THREE\) · you now have 13/.test(await promoGo('three')) && await until(async () => /13\/5 free rides/.test(await txt(obs, '#chip-free'))), await txt(obs, '#chip-free'));
check('PROMO: …and the next daily credit is not counted down (at / above the cap)', /full/.test(await txt(obs, '#chip-free')), await txt(obs, '#chip-free'));
check('PROMO: THREE again is refused with the reason', /already redeemed/.test(await promoGo('THREE')), await txt(obs, '#promo-msg'));
check('PROMO: GOLDWHEEL → unlocked and worn, with a pointer to the garage', /^Unlocked wheel: gold \(GOLDWHEEL\)/.test(await promoGo('goldwheel')) && /GARAGE/.test(await txt(obs, '#promo-msg')), await txt(obs, '#promo-msg'));
check('PROMO: the list of redeemed codes shows both with what they gave', await until(async () => /THREE.*3 free rides/.test(await txt(obs, '#my-codes')) && /GOLDWHEEL.*wheel: gold.*A golden wheel/.test(await txt(obs, '#my-codes'))), await txt(obs, '#my-codes'));

// ── GARAGE: the catalog, the progression, picking parts, SAVE into the database
const part = (slot, item) => `document.querySelector("#garage-slots [data-slot=${slot}] [data-item=${item}]")`;
await obs.ev('location.hash = "#garage"');
check('GARAGE: five slots × six parts, the progression (1 of 25 parts: the gold wheel), classics + the gold wheel marked, 24 locked', await until(async () => (await obs.ev('document.querySelectorAll("#garage-slots .slot").length')) === 5) && (await obs.ev('document.querySelectorAll("#garage-slots .item").length')) === 30 && /^COLLECTION1 \/ 25/.test(await txt(obs, '#garage-progress')) && (await obs.ev('document.querySelectorAll("#garage-slots .item.lock").length')) === 24 && (await obs.ev(`${part('wheel', 'gold')}.classList.contains('on') && ${part('wheel', 'gold')}.classList.contains('saved')`)) === true, await txt(obs, '#garage-progress'));
check('GARAGE: an owned part says which code unlocked it; the default says everybody has it; the preview is there', /Unlocked by GOLDWHEEL/.test(await obs.ev(`${part('wheel', 'gold')}.title`)) && /Everybody has this one/.test(await obs.ev(`${part('wheel', 'classic')}.title`)) && (await obs.ev('!!document.querySelector("#garage-preview canvas")')) === true);
check('GARAGE: nothing to save yet (SAVE disabled)', (await obs.ev('document.getElementById("garage-save").disabled')) === true);
await obs.ev(`${part('needle', 'cyan')}.click()`);
check('GARAGE: a locked part explains itself and cannot be picked – the API refuses it too (409 not_owned, nothing saved)', await until(async () => /locked/.test(await txt(obs, '#garage-msg'))) && (await obs.ev('document.getElementById("garage-save").disabled')) === true && (await post('garage/loadout', { loadout: { needle: 'cyan', wheel: 'classic' } }, P.cookie)).r.status === 409 && (await get('garage', P.cookie)).equipped.wheel === 'gold');
await obs.ev(`${part('wheel', 'classic')}.click()`);
check('GARAGE: picking a part marks it SELECTED, enables SAVE / RESET and says "Not saved yet"', await until(async () => (await obs.ev(`${part('wheel', 'classic')}.classList.contains('on')`)) === true) && /SELECTED/.test(await obs.ev(`${part('wheel', 'classic')}.textContent`)) && (await obs.ev('document.getElementById("garage-save").disabled')) === false && /Not applied yet/.test(await txt(obs, '#garage-actions')));
await obs.ev('document.getElementById("garage-reset").click()');
check('GARAGE: RESET puts the saved selection back – and the database never changed', await until(async () => (await obs.ev(`${part('wheel', 'gold')}.classList.contains('on')`)) === true) && (await obs.ev('document.getElementById("garage-save").disabled')) === true && (await get('garage', P.cookie)).equipped.wheel === 'gold');
await obs.ev(`${part('wheel', 'classic')}.click()`); await obs.ev('document.getElementById("garage-save").click()');
check('GARAGE: APPLY stores it in the database (GET /api/garage and /api/wardrobe agree) and says so', await until(async () => /Applied/.test(await txt(obs, '#garage-msg'))) && (await get('garage', P.cookie)).equipped.wheel === 'classic' && (await get('wardrobe', P.cookie)).equipped.wheel === 'classic');
await obs.shot('garage-desktop'); await size(obs, 390, 844, true); await sleep(300); await obs.shot('garage-phone'); await size(obs, 1100, 900, false);
await obs.send('Page.navigate', { url: `${BASE}/lobby.html?promo=bluepaint` });
check('PROMO: an invite link (lobby.html?promo=CODE) opens the PROMO tab with the code typed in – and only that', await until(async () => (await obs.ev('document.querySelector(".tabs a.on")?.dataset.tab')) === 'promo' && (await obs.ev('document.getElementById("promo-code")?.value')) === 'bluepaint') && (await obs.ev('location.search')) === '' && !JSON.stringify((await get('promo/mine', P.cookie)).redemptions).includes('BLUEPAINT'));
await obs.ev('document.getElementById("promo-go").click()'); await until(async () => /Unlocked/.test(await txt(obs, '#promo-msg')));
check('PROMO: …then REDEEM puts the blue paint on the truck (the wheel stays what was saved)', /^Unlocked truck color: blue \(BLUEPAINT\)/.test(await txt(obs, '#promo-msg')) && (await get('wardrobe', P.cookie)).equipped.truck_color === 'blue' && (await get('wardrobe', P.cookie)).equipped.wheel === 'classic', await txt(obs, '#promo-msg'));
// two slots in ONE save: the gold wheel back on and the pink dice (a part unlocked meanwhile, by the API)
await post('promo/redeem', { code: 'PINKDICE' }, P.cookie);
await obs.send('Page.navigate', { url: `${BASE}/lobby.html#garage` });
check('GARAGE: it opens at 3 of 25 (gold wheel, blue paint, pink dice)', await until(async () => /^COLLECTION3 \/ 25/.test(await txt(obs, '#garage-progress'))), await txt(obs, '#garage-progress'));
await obs.ev(`${part('wheel', 'gold')}.click()`); await obs.ev(`${part('dice', 'pink')}.click()`); await obs.ev(`${part('dice', 'pink')}.click()`);
await obs.ev('document.getElementById("garage-save").click()');
const worn = { wheel: 'gold', truck_color: 'blue', gearbox: 'stick', dice: 'pink', needle: 'orange' }, wornJson = JSON.stringify(worn);
check('GARAGE: two parts picked together are saved together', await until(async () => JSON.stringify((await get('garage', P.cookie)).equipped) === wornJson), JSON.stringify((await get('garage', P.cookie)).equipped));
// the whole point of a part: the game wears what the ride was started with (start answer = what is stamped on the ride) – and a spectator / the replay draws the SAME from the public watch API
const cosRide = await post('rides', { tier: 'free' }, P.cookie);
await obs.send('Page.navigate', { url: `${BASE}/play.html?ride=${cosRide.j.id}` });
check('PROMO: the game opens a ride of that wallet already wearing its parts (gold wheel, blue paint, pink dice)', await until(async () => JSON.stringify(await obs.ev('window.__game?.cosmetics ? { ...__game.cosmetics.loadout } : null')) === wornJson), JSON.stringify(await obs.ev('window.__game?.cosmetics ? { ...__game.cosmetics.loadout } : null')));
await post(`rides/${cosRide.j.id}/start`, {}, P.cookie);
check('PROMO: the started ride carries the loadout, and so does the PUBLIC watch API (live streams + replays)', JSON.stringify((await get(`rides/${cosRide.j.id}`, P.cookie)).loadout) === wornJson && JSON.stringify((await get(`watch/${cosRide.j.id}`)).ride.loadout) === wornJson);
await post('garage/loadout', { loadout: { wheel: 'classic', truck_color: 'red', dice: 'white' } }, P.cookie);   // the driver changes back AFTER the start: the ride keeps what it was driven with
await obs.send('Page.navigate', { url: `${BASE}/play.html?watch=${cosRide.j.id}` });
check('PROMO: a spectator\'s game wears what the ride was driven with (the watch page never reads a wardrobe – only the ride\'s loadout), though the driver now wears the classics', await until(async () => JSON.stringify(await obs.ev('window.__game?.watch?.ride?.loadout')) === wornJson && JSON.stringify(await obs.ev('({ ...__game.cosmetics.loadout })')) === wornJson), JSON.stringify(await obs.ev('({ w: window.__game?.watch?.ride?.loadout, c: window.__game?.cosmetics ? { ...__game.cosmetics.loadout } : null })')));
await sleep(1200); await obs.shot('promo-in-game');
check('…and no unexpected page errors (promo, garage)', problems(obs).length === 0, problems(obs).join(' | '));
await obs.send('Page.navigate', { url: `${BASE}/lobby.html#new` }); await sleep(800);

// ── LANDING (signed in: no forced redirect, CTA becomes the lobby link; public numbers agree with the API)
await size(obs, 1100, 900, false); await open(obs, B, `${BASE}/`);
check('landing: stays on / and shows the pool', await until(async () => (await obs.ev('location.pathname')) === '/' && /SOL$/.test(await obs.ev('document.querySelector("#poolbox .big")?.textContent || ""'))));
check('landing: the hero stat is the escrow across the pools', await until(async () => /^IN ESCROW · \d+ POOLS?$/.test(await txt(obs, '#hero-pot-lbl'))), await txt(obs, '#hero-pot-lbl'));
check('landing: 4 shifts + three boards rendered (next up, top, recent rides – the LIVE NOW card is gone, the ticker carries it)', await until(async () => (await obs.ev('document.querySelectorAll("#tiers tbody tr").length')) === 4 && (await obs.ev('["board-next","board-top","board-recent"].every(i => (document.getElementById(i)?.textContent ?? "").trim().length > 0)')) === true));
check('landing: ticker carries the finished ride + the escrow', await until(async () => { const t = await obs.ev('document.getElementById("ticker").textContent'); return /finished a test ride/.test(t) && /in escrow/.test(t); }), (await obs.ev('document.getElementById("ticker").textContent'))?.slice(0, 400));
check('landing: all-time km counter > 0 after the completed ride', await until(async () => parseFloat(await obs.ev('document.getElementById("hero-km").textContent')) > 0));
check('landing: signed-in CTA opens the lobby', await until(async () => /LOBBY/.test(await obs.ev('document.getElementById("connect").textContent'))));
check('landing: pool = /api/pool', (await obs.ev('document.querySelector("#poolbox .big").textContent')) === (l => `${(l / 1e9).toFixed(l >= 1e9 ? 2 : 3)} SOL`)((await get('pool')).split.grand));
const pools = (await get('pools')).pools;
check('landing: the live pools board = /api/pools (one row each, "sold / min committed", escrow, explorer link)', await until(async () => (await obs.ev('document.querySelectorAll("#pools .prow").length')) === pools.length) && (await txt(obs, '#pools')).includes(`${open4h.sold} / ${open4h.minTickets} committed`) && (await obs.ev(`[...document.querySelectorAll("#pools a")].some(a => a.href === "https://explorer.solana.com/address/${open4h.address}?cluster=devnet")`)), (await txt(obs, '#pools')).slice(0, 160));
check('landing: the escrow block links the whitepaper\'s escrow chapter', await obs.ev('/\\/whitepaper\\.html#onchain$|^https?:\\/\\/whitepaper\\.[^/]+\\/?#onchain$/.test(document.getElementById("escrow-link")?.href || "")'), await obs.ev('document.getElementById("escrow-link")?.href'));
const ex = await fetch(`${BASE}/escrow/`); check('the old /escrow/ page is gone; the whitepaper chapter is the explainer', ex.status === 404);
const toPools = async () => { await obs.ev('document.querySelectorAll(".rv").forEach(n => n.classList.add("in")); document.getElementById("pools").scrollIntoView({ behavior: "instant", block: "center" })'); await sleep(1200); };   // .rv fades in on scroll
await obs.shot('landing-desktop'); await toPools(); await obs.shot('landing-pools-desktop');
await obs.ev('scrollTo({ top: 0, behavior: "instant" })'); await size(obs, 390, 844, true); await sleep(300); await obs.shot('landing-phone'); await toPools(); await obs.shot('landing-pools-phone');

// ── the READY free ride at 0 credits: spend nine credits out of band, order the tenth (MEDIUM) and leave it unstarted – the lobby keeps START on and hands back THAT ride   (last: its nine burnt rides would crowd the finished one off the landing ticker – it shows the 8 newest)
for (let i = 0; i < 9; i++) { const { j } = await post('rides', { tier: 'free' }, C.cookie); await post(`rides/${j.id}/start`, {}, C.cookie); await post(`rides/${j.id}/end`, { outcome: 'failed', s: 0, t: 0, reason: 'e2e' }, C.cookie); }
const readyC = (await post('rides', { tier: 'free', level: 2 }, C.cookie)).j;
const meC = await get('me', C.cookie);
check('API: 0 free rides left, /api/me carries the ready free ride (id, level 2, trip free-2c)', meC.freeRides === 0 && meC.readyFreeRide?.id === readyC.id && meC.readyFreeRide.level === 2 && meC.readyFreeRide.trip === 'free-2c', JSON.stringify({ freeRides: meC.freeRides, ready: meC.readyFreeRide }));
await open(third, C, `${BASE}/lobby.html?ready=1#new`);   // a new query: the same URL with only a hash would not reload the page (no fresh /api/me)
check('0/5 free rides, yet START is ENABLED and says the ride is ready; MEDIUM is preselected from the ride', await until(async () => /^0\/5 free rides/.test(await txt(third, '#chip-free')) && (await third.ev('document.getElementById("start")?.disabled')) === false && (await txt(third, '#start')) === 'START FREE RIDE · ready' && (await third.ev('document.getElementById("level-2")?.checked')) === true), `${await txt(third, '#chip-free')} | ${await txt(third, '#start')}`);
await third.shot('free-ready-desktop');
await third.ev('document.getElementById("start").click()');
check('…START reopens the SAME ride (no credit spent, still 0)', await until(async () => await third.ev(`!!window.__game?.online?.ride && __game.online.ride.id === ${JSON.stringify(readyC.id)}`)) && (await get('me', C.cookie)).freeRides === 0, await third.ev('JSON.stringify(window.__game?.online?.ride?.id ?? null)'));

const p1 = problems(rider), p2 = problems(obs); check('no page errors (rider, observer)', !p1.length && !p2.length, [...p1, ...p2].join(' | '));
console.log(`screenshots: ${rider.SHOTS}`);
const code = fails.length ? 1 : 0;   // every finish() schedules a process.exit – give them all the same code so the first one to fire can't hide a failure
rider.finish(code, 300); obs.finish(code, 300); third.finish(code, 300); tix.finish(code, 300);
