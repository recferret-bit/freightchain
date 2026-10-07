// The admin page in REAL headless Chrome against a RUNNING server: a non-admin sees "not available" (the API answers 404), the admin sees the overview,
// the review queue holds a flagged ride, the ride detail shows its reasons and batches, ACCEPT turns it verified (audited, the rider sees it), sign-ins,
// logs and the audit tab render; screenshots at desktop + phone width. No wallet extension: keypairs sign the challenges.
// Server: FREE_RIDE_SECONDS=3 ADMIN_WALLETS=<admin address> … node dist/main.js – easiest via `bash .claude/skills/run-tests/e2e.sh admin` (creates the admin keypair).
//   ADMIN_KEYPAIR=<path to a JSON array secret key> BASE=http://localhost:<port> node scripts/e2e-admin.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111';
const fails = []; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const post = async (p, b, c) => { const r = await fetch(`${BASE}/api/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(c && { cookie: c }) }, body: JSON.stringify(b) }); return { r, j: await r.json().catch(() => ({})) }; };
const get = async (p, c) => { const r = await fetch(`${BASE}/api/${p}`, { headers: c ? { cookie: c } : {} }); return { r, j: await r.json().catch(() => ({})) }; };
async function signIn(kp) {
  const address = bs58.encode(kp.publicKey), { j } = await post('auth/nonce', { wallet: address });
  const { r } = await post('auth/verify', { wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) });
  return { address, short: `${address.slice(0, 4)}…${address.slice(-4)}`, cookie: r.headers.get('set-cookie').split(';')[0] };
}
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
async function open(h, w, url) { const [n, v] = w.cookie.split('='); await h.send('Network.setCookie', { name: n, value: v, url: BASE, httpOnly: true }); await h.send('Page.navigate', { url }); }
const size = (h, w, hgt, mobile) => h.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile });

/* a recording like the game's (client/js/telemetry.js): hash-chained batches, 10 Hz samples, some key presses – covering `seconds` of a ride ending at `metres` */
function recording(rideId, seconds, metres) {
  const out = []; let prev = rideId;
  for (let seq = 0, t0 = 0; t0 < seconds; seq++, t0 += 1) {
    const t1 = Math.min(seconds, t0 + 1), samples = [];
    for (let t = t0; t < t1 - 1e-9; t = Math.round((t + 0.1) * 10) / 10) samples.push([t, Math.round(metres * t / seconds * 10) / 10, 2.4, 0, 14, 1700, 3, 100, 1, 0, 0, 0]);
    const body = { seq, prevHash: prev, t0, t1, samples, inputs: [[t0 * 1000 + 120.5, 'KeyW', 1], [t0 * 1000 + 610.2, 'KeyW', 0]] };
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    out.push({ ...body, hash }); prev = hash;
  }
  return out;
}

const admin = await signIn(nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR, 'utf8')))));
const rider = await signIn(nacl.sign.keyPair());

// ── a flagged ride: a 3 s free shift whose recording covers only 2 s (coverage 67 % → 'recording-gaps')
const { j: ride } = await post('rides', { tier: 'free' }, rider.cookie);
await post(`rides/${ride.id}/start`, {}, rider.cookie);
for (const b of recording(ride.id, 2, 42)) await post(`rides/${ride.id}/batches`, b, rider.cookie);
await sleep(3200);   // the server credits driven time against its own clock
const { j: ended } = await post(`rides/${ride.id}/end`, { outcome: 'shift', s: 42, t: 3, hull: 100 }, rider.cookie);
check('setup: the ride ended COMPLETED and FLAGGED (recording-gaps)', ended.status === 'completed' && ended.verdict?.status === 'flagged', JSON.stringify(ended.verdict));

// ── the API is invisible to a non-admin
check('a rider gets 404 from /api/admin/*', (await get('admin/overview', rider.cookie)).r.status === 404 && (await get('admin/rides', rider.cookie)).r.status === 404);
check('signed out: 404 too', (await get('admin/overview')).r.status === 404);
check('a POST without X-FC-Admin is refused even for the admin (403)', (await post(`admin/rides/${ride.id}/verdict`, { decision: 'verified' }, admin.cookie)).r.status === 403);

const A = await launch({ port: +process.env.CHROME_PORT || 9351, shotsDir: 'fc-admin-shots', evalProblems: true });
const R = await launch({ port: (+process.env.CHROME_PORT || 9351) + 1, shotsDir: 'fc-admin-shots', evalProblems: true });
await size(A, 1200, 900, false); await size(R, 1100, 800, false);

// ── a rider opening the page
await open(R, rider, `${BASE}/admin.html`);
check('rider: the page says NOT AVAILABLE and hides the tabs', await until(async () => (await R.ev('!!document.getElementById("denied") && document.querySelector(".tabs").hidden'))));
await R.shot('denied');

// ── the admin: overview
await open(A, admin, `${BASE}/admin.html#overview`);
check('admin: overview tiles render', await until(async () => (await A.ev('document.querySelectorAll(".tile").length')) === 6), String(await A.ev('document.querySelectorAll(".tile").length')));
check('admin: header shows the wallet and the verdict mode', (await A.ev('document.getElementById("chip-wallet").textContent')) === admin.short && /VERDICTS ENFORCED|SHADOW MODE/.test(await A.ev('document.getElementById("chip-mode").textContent')));
check('admin: the queue badge counts 1', await until(async () => (await A.ev('document.getElementById("tab-queue-n").textContent')) === '1'));
await A.shot('overview-desktop');

// ── queue → ride → ACCEPT
await A.ev('location.hash = "#queue"');
check('queue: the flagged ride is listed with the rider', await until(async () => (await A.ev('document.querySelector("tbody")?.textContent || ""')).includes(rider.short)));
await A.shot('queue-desktop');
await A.ev('document.querySelector("tr.click").click()');
check('ride: reasons, batches and the decision buttons render', await until(async () => /recording-gaps/.test(await A.ev('document.querySelector(".reasons")?.textContent || ""')) && (await A.ev('document.querySelectorAll("tbody tr").length')) === 2));
await A.shot('ride-desktop');
await A.ev('document.getElementById("note").value = "e2e: accepted by the admin page"');
await A.ev('[...document.querySelectorAll(".actions button")].find(b => /ACCEPT/.test(b.textContent)).click()');
check('ACCEPT: the page shows VERIFIED, decided by the admin', await until(async () => /VERIFIED/.test(await A.ev('document.querySelector(".v")?.textContent || ""')) && /decided by/.test(await A.ev('document.getElementById("view").textContent'))));
const after = (await get(`rides/${ride.id}`, rider.cookie)).j.verdict;
check('…and the rider sees verified + the override', after?.status === 'verified' && after?.override?.by === admin.address && after.override.note === 'e2e: accepted by the admin page', JSON.stringify(after));

// ── audit, sign-ins, logs, rides
await A.ev('location.hash = "#audit"');
check('audit: the override is logged', await until(async () => /verdict\.override/.test(await A.ev('document.querySelector("tbody")?.textContent || ""'))));
await A.ev('location.hash = "#signins"');
check('sign-ins: both wallets with an ip', await until(async () => { const t = await A.ev('document.querySelector("tbody")?.textContent || ""'); return t.includes(rider.short) && t.includes(admin.short); }));
await A.shot('signins-desktop');
await A.ev(`location.hash = "#logs/${ride.id}"`);
check('logs: lines for the ride id (requests + the verdict and admin events)', await until(async () => (await A.ev('document.querySelectorAll(".log .l").length')) >= 3), String(await A.ev('document.querySelectorAll(".log .l").length')));
await A.shot('logs-desktop');
await A.ev('location.hash = "#rides"');
check('rides: the table lists the ride', await until(async () => (await A.ev('document.querySelector("tbody")?.textContent || ""')).includes(rider.short)));
await size(A, 390, 844, true); await sleep(300); await A.shot('rides-phone');
await A.ev(`location.hash = "#ride/${ride.id}"`); await sleep(800); await A.shot('ride-phone');

const probs = [...A.filt(), ...R.filt().filter(p => !/404/.test(p))];   // the rider's page logs its own 404 on purpose
check('no page errors', probs.length === 0, probs.join(' | '));
console.log(`screenshots: ${A.SHOTS}`);
A.finish(fails.length ? 1 : 0);   // (finish exits the process; the second Chrome is killed by its own exit hook)
