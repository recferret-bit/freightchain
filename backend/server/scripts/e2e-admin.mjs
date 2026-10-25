// The admin page in REAL headless Chrome against a RUNNING server: a non-admin sees "not available" (the API answers 404), the admin sees the overview,
// the review queue holds a flagged ride, the ride detail shows its reasons and batches, ACCEPT turns it verified (audited, the rider sees it), the POOLS tab
// (every pool, its phase and winners; HOLD → RELEASE of the payout, both signed – on a live pool if there is one), sign-ins, logs and the audit tab render; screenshots at desktop + phone width. No wallet extension: keypairs sign the challenges.
// Server: FREE_RIDE_SECONDS=3 TRAFFIC_PROOF_REQUIRED=true ADMIN_WALLETS=<admin address> … node dist/main.js – easiest via `bash .claude/skills/run-tests/e2e.sh admin` (creates the admin keypair).
//   ADMIN_KEYPAIR=<path to a JSON array secret key> BASE=http://localhost:<port> node scripts/e2e-admin.mjs
//   SEED=1 + the server's DATABASE_URL (optional; CLI=<path to cli/index.js>, default dist/cli/index.js): seeds a live 1h pool (id 901) for the HOLD → RELEASE round trip – dev-only, throwaway database
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { execFileSync } from 'node:child_process';
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';
import { encodeTrafficProof } from '../../../frontend/client/shared/traffic-proof.js';
const BASE = process.env.BASE || 'http://localhost:3111';
const fails = []; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const post = async (p, b, c) => { const r = await fetch(`${BASE}/api/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(c && { cookie: c }) }, body: JSON.stringify(b) }); return { r, j: await r.json().catch(() => ({})) }; };
const get = async (p, c) => { const r = await fetch(`${BASE}/api/${p}`, { headers: c ? { cookie: c } : {} }); return { r, j: await r.json().catch(() => ({})) }; };
async function signIn(kp) {
  const address = bs58.encode(kp.publicKey), { j } = await post('auth/nonce', { wallet: address });
  const { r } = await post('auth/verify', { wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) });
  return { address, short: `${address.slice(0, 4)}…${address.slice(-4)}`, cookie: r.headers.get('set-cookie').split(';')[0] };
}
/** the admin sign-in from node (/api/admin/auth/*, the fc_admin cookie) – for the API-level checks; the page signs in through the fake wallet below */
async function adminSignIn(kp) {
  const address = bs58.encode(kp.publicKey), h = { 'content-type': 'application/json', 'x-fc-admin': '1' };
  const n = await (await fetch(`${BASE}/api/admin/auth/nonce`, { method: 'POST', headers: h, body: JSON.stringify({ wallet: address }) })).json();
  const r = await fetch(`${BASE}/api/admin/auth/verify`, { method: 'POST', headers: h, body: JSON.stringify({ wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)) }) });
  return r.headers.get('set-cookie')?.split(';')[0] ?? '';
}
/* a fake Phantom (window.solana) holding THIS keypair: WebCrypto ed25519 from the nacl secret key (seed = its first 32 bytes) – the server verifies real signatures */
const b64u = bytes => Buffer.from(bytes).toString('base64url');
const fakeWallet = kp => `(() => {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = bytes => { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); let o = ''; while (n > 0n) { o = A[Number(n % 58n)] + o; n /= 58n; } for (const b of bytes) { if (b) break; o = '1' + o; } return o; };
  const jwk = { kty: 'OKP', crv: 'Ed25519', d: ${JSON.stringify(b64u(kp.secretKey.slice(0, 32)))}, x: ${JSON.stringify(b64u(kp.publicKey))} };
  const key = crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
  const pub = ${JSON.stringify(bs58.encode(kp.publicKey))};
  window.__signed = 0;
  window.solana = { isPhantom: true, publicKey: null,
    async connect() { this.publicKey = { toString: () => pub }; return { publicKey: this.publicKey }; },
    async signMessage(msg) { window.__signed++; window.__lastMessage = new TextDecoder().decode(msg); return { signature: new Uint8Array(await crypto.subtle.sign('Ed25519', await key, msg)) }; },
    async disconnect() {} };
  window.__fcDevWallet = window.solana;
  void b58;
})();`;
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
async function open(h, w, url) { const [n, v] = w.cookie.split('='); await h.send('Network.setCookie', { name: n, value: v, url: BASE, httpOnly: true }); await h.send('Page.navigate', { url }); }
const size = (h, w, hgt, mobile) => h.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile });

/* Two 1.5 s batches: full, hashed 20 Hz traffic evidence, but only 10 samples per batch (2 s of 10 Hz coverage).
   The short gaps between sample groups stay below the sample-gap rejection threshold. Only recording-gaps should flag. */
function recording(rideId, seconds, metres) {
  const out = [], speed = metres / seconds; let prev = rideId;
  for (let seq = 0; seq < 2; seq++) {
    const t0 = seq * seconds / 2, t1 = (seq + 1) * seconds / 2, samples = [], frames = [];
    for (let i = 1; i <= 10; i++) {
      const t = Number((t0 + i / 10).toFixed(2));
      samples.push([t, Math.round(speed * t * 10) / 10, 2.4, 0, speed, 1700, 3, 100, 1, 0, 0, 0]);
    }
    for (let i = 0; i < 30; i++) {
      const time = Number((t0 + i / 20).toFixed(2));
      frames.push([.05, time, speed * (time + .05), 2.4, 0, 0, speed, speed, 100, 0, 0, 100]);
    }
    const body = { seq, prevHash: prev, t0, t1, samples, inputs: [[t0 * 1000 + 120.5, 'KeyW', 1], [t0 * 1000 + 610.2, 'KeyW', 0]], trafficProof: encodeTrafficProof(frames) };
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    out.push({ ...body, hash }); prev = hash;
  }
  return out;
}

const adminKp = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR, 'utf8')))), riderKp = nacl.sign.keyPair();
const admin = await signIn(adminKp);   // the admin's PLAYER session (signed in on the site) – grants nothing on the admin API
const rider = await signIn(riderKp);

// ── a flagged ride: full traffic proof, 2 s of samples across a 3 s free shift (coverage 67%).
const { r: ordered, j: ride } = await post('rides', { tier: 'free' }, rider.cookie);
if (!ordered.ok || ride.minSeconds !== 3) throw new Error(`admin fixture requires FREE_RIDE_SECONDS=3 (status ${ordered.status}, minSeconds ${ride.minSeconds})`);
const started = await post(`rides/${ride.id}/start`, {}, rider.cookie);
if (!started.r.ok || started.j.trafficVersion !== 1) throw new Error(`admin fixture requires TRAFFIC_PROOF_REQUIRED=true (start ${started.r.status}, trafficVersion ${started.j.trafficVersion})`);
const began = Date.now();
for (const b of recording(ride.id, 3, 42)) {
  await sleep(Math.max(0, began + b.t1 * 1000 + 100 - Date.now()));
  const uploaded = await post(`rides/${ride.id}/batches`, b, rider.cookie);
  if (!uploaded.r.ok) throw new Error(`admin fixture batch ${b.seq} refused: ${uploaded.r.status}`);
}
const { j: ended } = await post(`rides/${ride.id}/end`, { outcome: 'shift', s: 42, t: 3, hull: 100 }, rider.cookie);
let flagged;
await until(async () => { flagged = (await get(`rides/${ride.id}`, rider.cookie)).j.verdict; return flagged && flagged.status !== 'pending'; });
const ready = ended.status === 'completed' && flagged?.status === 'flagged' && flagged.reasons.length === 1 && flagged.reasons[0].code === 'recording-gaps';
check('setup: COMPLETED and FLAGGED only for recording-gaps, with required traffic proof', ready, JSON.stringify(flagged));
if (!ready) throw new Error('admin fixture must be COMPLETED with only recording-gaps flagged');

// ── the API is invisible to a non-admin
check('a rider gets 404 from /api/admin/*', (await get('admin/overview', rider.cookie)).r.status === 404 && (await get('admin/rides', rider.cookie)).r.status === 404);
check('signed out: 404 too', (await get('admin/overview')).r.status === 404);
check('the admin wallet\'s PLAYER session gets 404 too (only the admin sign-in counts)', (await get('admin/overview', admin.cookie)).r.status === 404);
const adminCookie = await adminSignIn(adminKp);
check('the admin sign-in sets fc_admin and it opens the API', adminCookie.startsWith('fc_admin=') && (await get('admin/overview', adminCookie)).r.status === 200);
check('a POST without X-FC-Admin is refused even for the admin (403)', (await post(`admin/rides/${ride.id}/verdict`, { decision: 'verified' }, adminCookie)).r.status === 403);

const A = await launch({ port: +process.env.CHROME_PORT || 9351, shotsDir: 'fc-admin-shots', evalProblems: true });
const R = await launch({ port: (+process.env.CHROME_PORT || 9351) + 1, shotsDir: 'fc-admin-shots', evalProblems: true });
await size(A, 1200, 900, false); await size(R, 1100, 800, false);

// ── a rider opening the page
await R.send('Page.addScriptToEvaluateOnNewDocument', { source: fakeWallet(riderKp) });
await open(R, rider, `${BASE}/admin.html`);
check('rider: the page asks for the ADMIN sign-in and hides the tabs', await until(async () => (await R.ev('!!document.getElementById("admin-signin") && document.querySelector(".tabs").hidden'))));
await R.ev('document.getElementById("admin-signin").click()');
check('rider: SIGN IN AS ADMIN with a non-admin wallet leaves the admin tabs closed', await until(async () => (await R.ev('document.querySelector(".tabs")?.hidden === true && document.querySelectorAll(".tile").length === 0 && /ADMIN SIGN-IN|not an admin wallet/.test(document.getElementById("denied")?.textContent || "")'))));
await R.shot('denied');

// ── the admin: the admin sign-in through the wallet, then the overview (the player cookie alone shows the sign-in card)
await A.send('Page.addScriptToEvaluateOnNewDocument', { source: fakeWallet(adminKp) });
await open(A, admin, `${BASE}/admin.html#overview`);
check('admin: the player session alone shows the ADMIN sign-in', await until(async () => !!(await A.ev('!!document.getElementById("admin-signin")'))));
await A.ev('document.getElementById("admin-signin").click()');
await sleep(500);
check('admin: overview tiles render', await until(async () => (await A.ev('document.querySelectorAll(".tile").length')) === 6), String(await A.ev('document.querySelectorAll(".tile").length')));
check('admin: header shows the admin wallet + until when, and the verdict mode', (await A.ev('document.getElementById("chip-wallet").textContent')).startsWith(`${admin.short} · until `) && /VERDICTS ENFORCED|SHADOW MODE/.test(await A.ev('document.getElementById("chip-mode").textContent')));
check('admin: the queue badge counts this ride', await until(async () => Number(await A.ev('document.getElementById("tab-queue-n").textContent')) >= 1));
await A.shot('overview-desktop');

// ── queue → ride → ACCEPT
await A.ev('location.hash = "#queue"');
check('queue: the flagged ride is listed with the rider', await until(async () => (await A.ev('document.querySelector("tbody")?.textContent || ""')).includes(rider.short)));
await A.shot('queue-desktop');
await A.ev('document.querySelector("tr.click").click()');
check('ride: reasons, batches and the decision buttons render', await until(async () => /recording-gaps/.test(await A.ev('document.querySelector(".reasons")?.textContent || ""')) && (await A.ev('document.querySelectorAll("tbody tr").length')) === 2));
check('ride: sample inspection shows 10 samples in each uploaded batch', await A.ev(`(() => { const table = [...document.querySelectorAll('table')].find(t => /samples/.test(t.querySelector('thead')?.textContent || '')); return table ? [...table.querySelectorAll('tbody tr')].map(tr => tr.children[2]?.textContent).join(',') : ''; })()`) === '10,10');
await A.shot('ride-desktop');
await A.ev('document.getElementById("note").value = "e2e: accepted by the admin page"');
await A.ev('[...document.querySelectorAll(".actions button")].find(b => /ACCEPT/.test(b.textContent)).click()');
check('ACCEPT: the page shows VERIFIED, decided by the admin', await until(async () => /VERIFIED/.test(await A.ev('document.querySelector(".v")?.textContent || ""')) && /decided by/.test(await A.ev('document.getElementById("view").textContent'))));
check('ACCEPT was signed by the admin wallet for exactly this ride and decision', (await A.ev(`(window.__lastMessage || '').includes('Action: set the verdict to VERIFIED') && (window.__lastMessage || '').includes('Ride: ${ride.id}')`)) === true);
const after = (await get(`rides/${ride.id}`, rider.cookie)).j.verdict;
check('…and the rider sees verified + the override', after?.status === 'verified' && after?.override?.by === admin.address && after.override.note === 'e2e: accepted by the admin page', JSON.stringify(after));

await A.ev('[...document.querySelectorAll(".actions button")].find(b => /RE-JUDGE/.test(b.textContent)).click()');
check('RE-JUDGE: the checks run again and replace the decision (FLAGGED again)', await until(async () => /FLAGGED/.test(await A.ev('document.querySelector(".v")?.textContent || ""')) && !/decided by/.test(await A.ev('document.getElementById("view").textContent'))));

// ── PROMO CODES: create with the form (signed), see it active, a player redeems it, who used it, disable (signed)
await A.ev('location.hash = "#promos"');
check('promos: the tab renders with the ACTIVE filter, the list (or its empty card – other suites may have seeded codes) and the form', await until(async () => (await A.ev('!!document.getElementById("promo-form")')) === true) && (await A.ev('document.querySelector("#promo-states .on")?.dataset.state')) === 'active' && ((await A.ev('!!document.getElementById("promo-table")')) || /No active promo codes/.test(await A.ev('document.getElementById("view").textContent'))));
const setField = (id, v) => A.ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const submitPromo = () => A.ev('document.getElementById("promo-form").requestSubmit()');
await setField('pf-kind', 'ride'); await setField('pf-ride', '1h');
await setField('pf-code', ' e2e three '); await setField('pf-desc', 'E2E: three rides'); await setField('pf-max', '5'); await setField('pf-end', '2099-01-01T00:00');
const signedBefore = await A.ev('window.__signed');
await submitPromo();
check('promos: SIGN & CREATE → the code is listed ACTIVE with what it gives and its text', await until(async () => /E2ETHREE/.test(await A.ev('document.getElementById("promo-table")?.textContent || ""'))) && /one free 1h ride/.test(await A.ev('document.getElementById("promo-table").textContent')) && /ACTIVE/.test(await A.ev('document.getElementById("promo-table").textContent')) && /E2E: three rides/.test(await A.ev('document.getElementById("promo-table").textContent')), await A.ev('document.getElementById("view").textContent.slice(0, 300)'));
check('promos: the wallet signed the text of exactly this code (every field in one JSON line)', (await A.ev('window.__signed')) === signedBefore + 1 && (await A.ev(`(window.__lastMessage || '').includes('Action: CREATE promo code E2ETHREE') && (window.__lastMessage || '').includes('Gives: one free 1h ride (not for sale)') && (window.__lastMessage || '').includes('"maxRedemptions":5')`)) === true);
const promoRider = await signIn(nacl.sign.keyPair());
const first = await post('promo/redeem', { code: 'e2e three' }, promoRider.cookie);
check('promos: a player redeems the ride code', first.r.status === 200 && first.j.kind === 'ride' && first.j.tier === '1h', JSON.stringify(first.j));
await A.ev('document.getElementById("refresh").click()');   // reload the tab (a player redeemed meanwhile)
check('promos: the list counts the use (1 / 5) and USED BY PLAYERS shows the wallet and what it got', await until(async () => /1 \/ 5/.test(await A.ev('document.getElementById("promo-table")?.textContent || ""')) && (await A.ev('document.getElementById("promo-used")?.textContent || ""')).includes(promoRider.short) && /one free 1h ride/.test(await A.ev('document.getElementById("promo-used").textContent'))));
check('promos: only a ride code and tickets can be created; cosmetic codes are not offered', (await A.ev('[...document.querySelectorAll("#pf-kind option")].map(o => o.value).join(",")')) === 'ride,tickets');
await setField('pf-code', 'E2E-TICKETS'); await setField('pf-kind', 'tickets'); await setField('pf-tier', '1h'); await setField('pf-credits', '2');
await submitPromo();
check('promos: a ticket code through the same signed form', await until(async () => /2 × 1h ride tickets/.test(await A.ev('document.querySelector("#promo-table tr[data-code=E2E-TICKETS]")?.textContent || ""'))));
await setField('pf-code', ''); await submitPromo();
check('promos: a form mistake is explained on the page and nothing is signed', await until(async () => /Give the code a name/.test(await A.ev('document.getElementById("promo-note")?.textContent || ""'))) && (await A.ev('window.__signed')) === signedBefore + 2, await A.ev('document.getElementById("promo-note")?.textContent'));
await A.shot('promos-desktop');
await A.ev('[...document.querySelectorAll("#promo-table tr")].find(r => r.dataset.code === "E2ETHREE").querySelector("button.reject").click()');
check('promos: DISABLE (signed) removes it from the ACTIVE list', await until(async () => !/E2ETHREE/.test(await A.ev('document.getElementById("promo-table")?.textContent || ""'))));
check('promos: …the wallet signed the disable of exactly this code', (await A.ev(`(window.__lastMessage || '').includes('Action: DISABLE promo code E2ETHREE')`)) === true);
await A.ev('[...document.querySelectorAll("#promo-states button")].find(b => b.dataset.state === "disabled").click()');
check('promos: the DISABLED filter lists it', await until(async () => /E2ETHREE/.test(await A.ev('document.getElementById("promo-table")?.textContent || ""')) && /DISABLED/.test(await A.ev('document.getElementById("promo-table").textContent'))));
const second = await post('promo/redeem', { code: 'e2e three' }, (await signIn(nacl.sign.keyPair())).cookie);
check('promos: a disabled code is refused to players (409, "no longer valid")', second.r.status === 409 && /no longer valid/.test(second.j.detail), JSON.stringify(second.j));
await size(A, 390, 844, true); await sleep(300); await A.shot('promos-phone'); await size(A, 1200, 900, false);

// ── PAYOUTS: one card per pool (phase, sold / min, payout time, winners), then HOLD → RELEASE of a live pool's payout – each signed for exactly that pool
if (process.env.SEED === '1' && process.env.DATABASE_URL) {   // dev-only seed through the admin CLI (refused in production); "already exists" is fine
  try { execFileSync('node', [process.env.CLI || 'dist/cli/index.js', 'pool:seed', '--id', '901', '--tier', '1h', '--status', 'active', '--min', '1', '--label', 'E2E hold'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' }); console.log('seeded: pool 901 (1h, active)'); } catch { console.log('pool seed skipped (exists?)'); }
}
const adminPools = (await get('admin/pool-payouts', adminCookie)).j.pools ?? [];
await A.ev('location.hash = "#payouts"');
check('payouts: the tab renders one card per pool of GET /api/admin/pool-payouts', await until(async () => /^PAYOUTS · \d+$/.test(await A.ev('document.querySelector("#view h2")?.textContent || ""')) && (await A.ev('document.querySelectorAll(".apool").length')) === adminPools.length), `${await A.ev('document.querySelector("#view h2")?.textContent')} / ${adminPools.length}`);
const holdable = adminPools.find(x => ['open', 'active'].includes(x.pool.status) && x.pool.payout.state !== 'paid' && !x.hold);
if (holdable) {
  const id = holdable.pool.id, card = `#apool-${id}`, cardText = () => A.ev(`document.querySelector(${JSON.stringify(card)})?.textContent || ""`);
  check('payouts: the card shows the phase, sold / min, the payout time, the payout job and the winners heading', /ON SALE|FINISHING|IN REVIEW|PAY|NO WINNERS/.test(await cardText()) && (await cardText()).includes(`${holdable.pool.sold} / ${holdable.pool.minTickets} min`) && /payout at/.test(await cardText()) && /WINNERS · (FINAL|PROVISIONAL)/.test(await cardText()), (await cardText()).slice(0, 300));
  await A.shot('payouts-desktop');
  const signedBefore = await A.ev('window.__signed');
  await A.ev(`document.querySelector(${JSON.stringify(`${card} textarea`)}).value = "e2e: checking a lap"`);
  await A.ev(`document.querySelector(${JSON.stringify(`${card} button[data-act=hold]`)}).click()`);
  check('HOLD (signed): the card says ON HOLD with the note, a RELEASE button appears', await until(async () => /ON HOLD/.test(await cardText()) && /e2e: checking a lap/.test(await cardText()) && !!(await A.ev(`!!document.querySelector(${JSON.stringify(`${card} button[data-act=release]`)})`))), (await cardText()).slice(0, 300));
  check('…the wallet signed the hold of exactly this pool with its note', (await A.ev('window.__signed')) === signedBefore + 1 && (await A.ev(`(window.__lastMessage || '').includes('Action: HOLD the payout of pool ${id}') && (window.__lastMessage || '').includes('Note: "e2e: checking a lap"')`)) === true, await A.ev('window.__lastMessage'));
  check('…and the public pool says held', (await get('pools')).j.pools?.find(p => p.id === id)?.payout.held === true);
  await A.ev(`document.querySelector(${JSON.stringify(`${card} button[data-act=release]`)}).click()`);
  check('RELEASE (signed): the hold is gone', await until(async () => !/ON HOLD/.test(await cardText()) && !(await A.ev(`!!document.querySelector(${JSON.stringify(`${card} button[data-act=release]`)})`))) && (await A.ev(`(window.__lastMessage || '').includes('Action: RELEASE the payout hold of pool ${id}')`)) === true, (await cardText()).slice(0, 300));
  check('…the public pool is not held any more', (await get('pools')).j.pools?.find(p => p.id === id)?.payout.held === false);
  const acts = (await get('admin/actions?limit=50', adminCookie)).j.rows ?? [];
  check('…both changes audited with their signatures (pool.hold, pool.release)', ['pool.hold', 'pool.release'].every(a => acts.some(r => r.action === a && r.target === String(id) && r.detail?.signed)), JSON.stringify(acts.filter(r => r.action.startsWith('pool.'))));
  await size(A, 390, 844, true); await sleep(300); await A.shot('payouts-phone'); await size(A, 1200, 900, false);
} else console.log('skip: HOLD → RELEASE – no live pool on this server (SEED=1 with the server\'s DATABASE_URL seeds one)');
// ── SETTINGS: a knob (signed), one wallet's free rides (signed, +/-), a form mistake signs nothing
const setsBefore = await A.ev('window.__signed');
await A.ev('location.hash = "#settings"');
check('settings: all twenty-seven knobs render (free rides, weekly granted tickets, referrals, AI editor)', await until(async () => (await A.ev('document.querySelectorAll("#set-table input").length')) === 27 && (await A.ev('document.querySelector("#set-table input[data-key=weekly_ticket_1h_enabled]")?.value')) === '1' && (await A.ev('document.querySelector("#set-table input[data-key=weekly_ticket_1h_days]")?.value')) === '7' && (await A.ev('document.querySelector("#set-table input[data-key=weekly_ticket_4h_enabled]")?.value')) === '0' && (await A.ev('document.querySelector("#set-table input[data-key=weekly_ticket_4h_days]")?.value')) === '7' && (await A.ev('document.querySelector("#set-table input[data-key=weekly_ticket_8h_enabled]")?.value')) === '0' && (await A.ev('document.querySelector("#set-table input[data-key=weekly_ticket_8h_days]")?.value')) === '7' && (await A.ev('document.querySelector("#set-table input[data-key=free_rides_daily_max]")?.value')) === '5'));
check('settings: referral fields retain their per-key bounds', await A.ev(`(() => {
  const field = key => document.querySelector('#set-table input[data-key="' + key + '"]');
  return field('referral_max')?.value === '30' && field('referral_max')?.min === '1' && field('referral_max')?.max === '1000'
    && field('referral_referrer_part_bps')?.min === '5001' && field('referral_referrer_part_bps')?.max === '10000'
    && field('referral_donation_cap_lamports')?.max === '2000000000';
})()`));
await A.shot('settings-desktop');
await A.ev('(() => { const i = document.querySelector("#set-table input[data-key=free_rides_daily_max]"); i.value = "7"; })()');
await A.ev('document.querySelector("#set-table button[data-key=free_rides_daily_max]").click()');
check('settings: SIGN & SAVE shows the new value and signed exactly this change', await until(async () => (await A.ev('document.querySelector("#set-table input[data-key=free_rides_daily_max]")?.value')) === '7' && /is now 7/.test(await A.ev('document.getElementById("set-note")?.textContent || ""'))) && (await A.ev('window.__signed')) === setsBefore + 1 && (await A.ev(`(window.__lastMessage || '').includes('free_rides_daily_max')`)) === true);
await A.ev('(() => { const i = document.querySelector("#set-table input[data-key=free_rides_daily_max]"); i.value = "5"; })()');
await A.ev('document.querySelector("#set-table button[data-key=free_rides_daily_max]").click()');
check('settings: set back to 5', await until(async () => /is now 5/.test(await A.ev('document.getElementById("set-note")?.textContent || ""'))));
const balance0 = (await get('me', rider.cookie)).j.freeRides;
await setField('fr-wallet', 'not a wallet'); await setField('fr-delta', '3'); await A.ev('document.getElementById("fr-form").requestSubmit()');
const signedMistake = await A.ev('window.__signed');
check('settings: a bad wallet is explained and nothing is signed', await until(async () => /full wallet address/.test(await A.ev('document.getElementById("set-note")?.textContent || ""'))) && signedMistake === setsBefore + 2);
await setField('fr-wallet', rider.address); await setField('fr-delta', '3'); await A.ev('document.getElementById("fr-form").requestSubmit()');
check('settings: +3 free rides for a wallet (signed, balance reported)', await until(async () => /balance now/.test(await A.ev('document.getElementById("set-note")?.textContent || ""'))) && (await get('me', rider.cookie)).j.freeRides === balance0 + 3 && (await A.ev('window.__signed')) === signedMistake + 1 && (await A.ev(`(window.__lastMessage || '').includes('${rider.address}')`)) === true, String(balance0));
await setField('fr-wallet', rider.address); await setField('fr-delta', '-3'); await A.ev('document.getElementById("fr-form").requestSubmit()');
check('settings: -3 takes them back', await until(async () => (await get('me', rider.cookie)).j.freeRides === balance0));
await A.ev(`location.hash = "#settings/${rider.address}"`);
check('settings: #settings/<wallet> prefills the wallet', await until(async () => (await A.ev('document.getElementById("fr-wallet")?.value')) === rider.address));

// ── DIRECTORY: players (list → one rider), pools, statistics, sessions – all read-only
await A.ev('location.hash = "#players"');
check('players: the list shows the rider with the free-ride balance', await until(async () => (await A.ev(`document.querySelector('#pl-table tr[data-wallet="${rider.address}"]')?.textContent || ""`)).includes('/ 5')));
await A.shot('players-desktop');
await A.ev(`document.querySelector('#pl-table tr[data-wallet="${rider.address}"] a').click()`);
check('players: a click opens the rider – balances, their ride and sign-in, and the link to adjust free rides', await until(async () => !!(await A.ev('document.getElementById("pl-rides")')) && !!(await A.ev('document.getElementById("pl-signins")')) && (await A.ev('document.getElementById("pl-adjust")?.getAttribute("href")')) === `#settings/${rider.address}`));
await A.shot('player-desktop');
await A.ev('location.hash = "#pools"');
check('pools: the tab renders (a table, or its empty card – other suites may have mirrored pools)', await until(async () => !!(await A.ev('document.getElementById("pool-table")')) || /No pools mirrored/.test(await A.ev('document.getElementById("view").textContent'))));
await A.ev('location.hash = "#stats"');
check('stats: the game totals, the days and the top riders render', await until(async () => !!(await A.ev('document.getElementById("st-tiles")')) && !!(await A.ev('document.getElementById("st-top")')) && !!(await A.ev('document.getElementById("st-daily")'))));
await A.shot('stats-desktop');
await A.ev('location.hash = "#sessions"');
check('sessions: the rider and the admin signed in inside the window', await until(async () => { const t = await A.ev('document.getElementById("se-table")?.textContent || ""'); return t.includes(rider.short) && t.includes(admin.short); }));
await A.shot('sessions-desktop');

// ── audit, sign-ins, logs, rides
await A.ev('location.hash = "#audit"');
check('audit: the admin sign-ins, the override and the re-judge are logged, the changes with their signatures', await until(async () => { const t = await A.ev('document.querySelector("tbody")?.textContent || ""'); return /verdict\.override/.test(t) && /verdict\.rejudge/.test(t) && /auth\.signin/.test(t) && /promo\.create/.test(t) && /promo\.disable/.test(t) && /"signature"/.test(t); }));
await A.ev('location.hash = "#signins"');
check('sign-ins: both wallets with an ip', await until(async () => { const t = await A.ev('document.querySelector("tbody")?.textContent || ""'); return t.includes(rider.short) && t.includes(admin.short); }));
await A.shot('signins-desktop');
await A.ev(`location.hash = "#logs/${ride.id}"`);
check('logs: lines for the ride id (requests + the verdict and admin events)', await until(async () => (await A.ev('document.querySelectorAll(".log .l").length')) >= 3), String(await A.ev('document.querySelectorAll(".log .l").length')));
await A.shot('logs-desktop');
await A.ev('location.hash = "#rides"');
check('rides: the table lists the ride', await until(async () => (await A.ev('document.querySelector("tbody")?.textContent || ""')).includes(rider.short)));
await A.ev('location.hash = "#replays"');
check('replays: the replay verification queue and sessions render', await until(async () => /REPLAY VERIFICATION · QUEUE/.test(await A.ev('document.querySelector("#view h2")?.textContent || ""')) && (await A.ev('document.getElementById("replay-table")?.textContent || ""')).includes(ride.id.slice(0, 8))));
await size(A, 390, 844, true); await sleep(300); await A.shot('rides-phone');
check('phone admin keeps long alert wallets inside the viewport', await A.ev('document.documentElement.scrollWidth <= innerWidth + 1'));
check('phone alerts leave room for the admin tools', await A.ev('document.getElementById("alert-banner").getBoundingClientRect().height <= 220'));
await A.ev(`location.hash = "#ride/${ride.id}"`); await sleep(800); await A.shot('ride-phone');

// Host and signature, as the guard and AdminProofService actually answer. A split server (COOKIE_DOMAIN) 404s any host but admin.<apex>.
// A single-origin server leaves the host check off. A rejudge whose wallet never signed an issued challenge is 401, even with X-FC-Admin.
const hostStatus = (host, path) => new Promise((resolve, reject) => {
  const u = new URL(BASE);
  const req = httpRequest({ hostname: '127.0.0.1', port: u.port, path, method: 'GET', headers: { host, cookie: adminCookie } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
  req.on('error', reject); req.end();
});
const onApex = await hostStatus('freightchain.localhost', '/api/admin/overview');
const onAdmin = await hostStatus('admin.freightchain.localhost', '/api/admin/overview');
if (onAdmin === 200 && onApex === 404) check('wrong host is refused (AdminGuard 404, not 403)', true, `apex ${onApex} admin-host ${onAdmin}`);
else if (onApex === 200 && onAdmin === 200) check('single-origin server does not enforce the admin host', true, 'COOKIE_DOMAIN unset — both hosts 200');
else check('admin host check', false, `apex ${onApex} admin-host ${onAdmin}`);
const unsigned = await fetch(`${BASE}/api/admin/rides/${ride.id}/rejudge`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fc-admin': '1', cookie: adminCookie }, body: JSON.stringify({ signature: 'not-a-signed-challenge' }) });
check('a rejudge without an issued admin signature is 401', unsigned.status === 401, `${unsigned.status} ${await unsigned.text()}`);
const omitted = await fetch(`${BASE}/api/admin/rides/${ride.id}/rejudge`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fc-admin': '1', cookie: adminCookie }, body: JSON.stringify({}) });
check('a rejudge that omits the signature is refused before the change', omitted.status === 400 || omitted.status === 401, String(omitted.status));
await omitted.text().catch(() => {});

await A.ev('document.getElementById("signout").click()');
check('SIGN OUT ends the admin session (the sign-in card again, the API 404)', await until(async () => !!(await A.ev('!!document.getElementById("admin-signin")'))));
const probs = [...A.filt(), ...R.filt()].filter(p => !/404/.test(p) && !/401.*\/api\/admin\/auth\/verify/.test(p));   // both pages log the admin API's 404 before signing in, and a non-admin verify is 401, on purpose
check('no page errors', probs.length === 0, probs.join(' | '));
console.log(`screenshots: ${A.SHOTS}`);
A.finish(fails.length ? 1 : 0);   // (finish exits the process; the second Chrome is killed by its own exit hook)
