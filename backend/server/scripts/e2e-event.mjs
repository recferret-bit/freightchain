// The Pre-season $500 event surfaces in REAL headless Chrome: the admin EVENT TOP-20 tab (review flags, mocked sanctions check, prize table, lock, signed payout record)
// and the Profile table (GET /api/event/board, EN + RU, desktop + 390 px phone) before the review end, in the preliminary phase and after the lock.
// Seeds 26 wallets with verified event rides through the DATABASE (a tie, an RU and a BY wallet, one ending SNCT = the mocked sanctions hit); no wallet extension: keypairs sign.
// Server: ADMIN_WALLETS=<admin address> on a THROWAWAY database – `bash .claude/skills/run-tests/e2e.sh admin` runs it after e2e-admin.mjs.
//   ADMIN_KEYPAIR=<path> BASE=http://localhost:<port> DATABASE_URL=<throwaway db> CHROME_PORT=<port> node scripts/e2e-event.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { PrismaClient } from '@prisma/client';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';
import { acceptLocalTestTerms } from './local-test-terms.mjs';

const BASE = process.env.BASE || 'http://localhost:3111';
const db = process.env.DATABASE_URL;
assert(['localhost', '127.0.0.1'].includes(new URL(BASE).hostname) && db && /freightchain_e2e/.test(new URL(db).pathname), 'a loopback server and a freightchain_e2e* database are required');
const prisma = new PrismaClient({ datasources: { db: { url: db } } });
const fails = []; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const post = async (p, b, c) => { const r = await fetch(`${BASE}/api/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(c && { cookie: c }) }, body: JSON.stringify(b) }); return { r, j: await r.json().catch(() => ({})) }; };
async function signIn(kp) {
  const address = bs58.encode(kp.publicKey), { j } = await post('auth/nonce', { wallet: address });
  const { r } = await post('auth/verify', { wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) });
  return { address, cookie: await acceptLocalTestTerms(BASE, r.headers.get('set-cookie').split(';')[0]) };
}
const b64u = bytes => Buffer.from(bytes).toString('base64url');
const fakeWallet = kp => `(() => {
  const jwk = { kty: 'OKP', crv: 'Ed25519', d: ${JSON.stringify(b64u(kp.secretKey.slice(0, 32)))}, x: ${JSON.stringify(b64u(kp.publicKey))} };
  const key = crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
  const pub = ${JSON.stringify(bs58.encode(kp.publicKey))};
  window.__signed = 0;
  window.solana = { isPhantom: true, publicKey: null,
    async connect() { this.publicKey = { toString: () => pub }; return { publicKey: this.publicKey }; },
    async signMessage(msg) { window.__signed++; window.__lastMessage = new TextDecoder().decode(msg); return { signature: new Uint8Array(await crypto.subtle.sign('Ed25519', await key, msg)) }; },
    async disconnect() {} };
  window.__fcDevWallet = window.solana;
})();`;
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
const size = (h, w, hgt, mobile) => h.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile });
const cookieOn = async (h, cookie) => { const [n, v] = cookie.split('='); await h.send('Network.setCookie', { name: n, value: v, url: BASE, httpOnly: true }); };
const fakeAddr = tail => { for (;;) { const a = bs58.encode(randomBytes(40)).slice(0, 44 - tail.length) + tail; try { if (bs58.decode(a).length === 32) return a; } catch { /* retry */ } } };   // a valid-shaped address, not a key: the board never signs as these

// ── the field: 26 verified event rides, 1h, ranked, inside the window
const adminKp = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR, 'utf8'))));
const viewerKp = nacl.sign.keyPair();
const viewer = await signIn(viewerKp), adminPlayer = await signIn(adminKp);
const now = Math.floor(Date.now() / 1000);
const set = async o => { for (const [key, value] of Object.entries(o)) await prisma.gameSetting.upsert({ where: { key }, create: { key, value }, update: { value } }); };
const CODE = 'SYSTEM-PRESEASON-2026-11';
// e2e.sh runs every suite against ONE database: leave it as found (event_* settings would otherwise gate the next suites' ranked starts, and the seeded verdicts carry empty scores that `verdict:rejudge --status all` of the verified suites cannot read)
const eventSettingsBefore = await prisma.gameSetting.findMany({ where: { key: { startsWith: 'event_' } } });
const cleanup = async () => {
  const wallets = field.map(f => f.wallet).filter(w => w !== viewer.address);
  await prisma.ride.deleteMany({ where: { promoCode: CODE } });
  await prisma.signIn.deleteMany({ where: { wallet: { in: wallets } } });
  await prisma.eventWinner.deleteMany({}); await prisma.eventReview.deleteMany({}); await prisma.eventConfig.deleteMany({});
  await prisma.gameSetting.deleteMany({ where: { key: { startsWith: 'event_' } } });
  if (eventSettingsBefore.length) await prisma.gameSetting.createMany({ data: eventSettingsBefore });
  await prisma.player.deleteMany({ where: { wallet: { in: wallets } } });
};
const bail = async error => { console.log('FAIL event suite crashed –', error?.stack || error); await cleanup().catch(() => {}); process.exit(1); };
process.on('uncaughtException', bail); process.on('unhandledRejection', bail);
const field = [];
const add = (wallet, bps, country, tag) => field.push({ wallet, bps, country, tag });
add(fakeAddr('RUSS'), 9900, 'RU', 'ru'); add(fakeAddr('BELA'), 9850, 'BY', 'by');
add(viewer.address, 9700, 'KZ', 'viewer');
for (let i = 0; i < 21; i++) add(fakeAddr(`P${'abcdefghijkmnopqrstuv'[i]}Zz`), 9600 - i * 100, 'KZ', `p${i}`);
field.find(f => f.tag === 'p3').bps = field.find(f => f.tag === 'p2').bps;   // a tie in the prize places
add(fakeAddr('SNCT'), 9650, 'KZ', 'snct');
add(fakeAddr('EUro'), 7000, 'DE', 'eu');                                       // EU: on the board, no prize (geo list)                                      // the mocked sanctions hit, high enough to hold a prize place
const byTag = Object.fromEntries(field.map(f => [f.tag, f]));
for (const f of field) {
  await prisma.player.upsert({ where: { wallet: f.wallet }, create: { wallet: f.wallet, freeRides: 0, freeDay: '', createdAt: new Date() }, update: {} });
  await prisma.ride.create({ data: { wallet: f.wallet, tier: '1h', seed: 7, minSeconds: 3600, completeDist: 10000, status: 'completed', createdAt: new Date((now - 3100) * 1000), startedAt: new Date((now - 2900) * 1000), endedAt: new Date((now - 400) * 1000),
    ranked: true, lastS: 10000, cleanMetres: f.bps, prizeCountry: f.country, promoCode: CODE, verdict: { create: { status: 'verified', reasons: [], scores: {}, rulesVersion: 4, judgedAt: new Date() } } } });
}
// two wallets that signed in from one /24: the checklist's subnet flag
for (const w of [byTag.p5.wallet, byTag.p6.wallet]) await prisma.signIn.create({ data: { wallet: w, at: new Date(), ipHash: 'aa11bb22cc33dd44' } });
check('seeded 26 event rides', await prisma.ride.count({ where: { promoCode: CODE } }) === 26);
// the window ended 100 s ago; the table is published in 600 s (PENDING), appeals close in 1200 s
const schedule = (review, appeals) => set({ event_mode_enabled: 1, event_week_start_utc: now - 3000, event_last_start_utc: now - 2000, event_week_end_utc: now - 100, event_review_end_utc: review, event_appeals_end_utc: appeals });
await schedule(now + 600, now + 1200);

const A = await launch({ port: +process.env.CHROME_PORT || 9361, shotsDir: 'fc-event-shots', evalProblems: true });
const V = await launch({ port: (+process.env.CHROME_PORT || 9361) + 1, shotsDir: 'fc-event-shots', evalProblems: true });
await cookieOn(V, viewer.cookie);
const profile = async (lang, w, h, mobile, shot) => {
  await size(V, w, h, mobile);
  await V.send('Page.navigate', { url: `${BASE}/lobby.html?lang=${lang}#profile` });
  await until(async () => V.ev('!!document.getElementById("event-board-title")?.textContent'));
  await sleep(600);
  const text = await V.ev('document.getElementById("event-board-title")?.textContent');
  const box = await V.ev('document.getElementById("event-board")?.textContent || ""');
  await V.ev('document.getElementById("event-board-title").scrollIntoView()');
  await V.shot(shot);
  const overflow = await V.ev('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  return { text, box, overflow, rows: await V.ev('document.querySelectorAll("#event-board-table tbody tr").length') };
};

// ── public table: nothing before the review end
let p = await profile('en', 1100, 900, false, 'profile-pending-en');
check('public (before the review end): "EVENT TOP-20" + the publication note, no rows', p.text === 'EVENT TOP-20' && /published after the review/.test(p.box) && p.rows === 0, p.box.slice(0, 120));
p = await profile('ru', 1100, 900, false, 'profile-pending-ru');
check('public RU (before the review end): translated heading and note', p.text === 'ТОП-20 СОБЫТИЯ' && /публикуется после проверки/.test(p.box), p.text);

// ── the review end passes → preliminary table
await schedule(now - 50, now + 1200);
const board = await (await fetch(`${BASE}/api/event/board`)).json();
check('API: preliminary, wallets shortened', board.phase === 'preliminary' && board.rows.length >= 20 && board.rows.every(r => r.wallet.includes('…')), `${board.phase} ${board.rows.length}`);
check('API: RU/BY keep their rank and get no prize', board.rows[0].rank === 1 && board.rows[0].prizeEligible === false && board.rows[1].prizeEligible === false);
const tieRows = board.rows.filter(r => r.bps === byTag.p2.bps);
check('API: the tied wallets share one rank and the same (split) amount', tieRows.length === 2 && tieRows[0].rank === tieRows[1].rank && tieRows[0].amountCents === tieRows[1].amountCents, JSON.stringify(tieRows));
check('API: no full wallet leaks', !JSON.stringify(board).includes(byTag.p2.wallet) && !JSON.stringify(board).includes(byTag.ru.wallet));
p = await profile('en', 1100, 1100, false, 'profile-prelim-en');
check('public EN: preliminary note with the appeals date, rows, RU row "outside the prize standings"', /Preliminary table/.test(p.box) && p.rows >= 20 && /outside the prize standings/.test(p.box) && p.overflow <= 0, `rows ${p.rows} overflow ${p.overflow}`);
p = await profile('ru', 1100, 1100, false, 'profile-prelim-ru');
check('public RU: translated note, headers and "outside" label; no English left in the table', /Предварительная таблица/.test(p.box) && /вне призового зачёта/.test(p.box) && /Кошелёк/.test(await V.ev('document.getElementById("event-board-table").tHead.textContent')) && !/Preliminary|outside the prize|Wallet|Prize \(USDC\)/.test(p.box), p.box.slice(0, 160));
p = await profile('en', 390, 844, true, 'profile-prelim-phone-en');
check('phone 390 px (EN): the page does not scroll sideways', p.overflow <= 0, `overflow ${p.overflow}`);
p = await profile('ru', 390, 844, true, 'profile-prelim-phone-ru');
check('phone 390 px (RU): the page does not scroll sideways', p.overflow <= 0, `overflow ${p.overflow}`);

// ── the admin
await size(A, 1500, 1000, false);
await A.send('Page.addScriptToEvaluateOnNewDocument', { source: fakeWallet(adminKp) });
await cookieOn(A, adminPlayer.cookie);
await A.send('Page.navigate', { url: `${BASE}/admin.html#event` });
await until(async () => A.ev('!!document.getElementById("admin-signin")'));
await A.ev('document.getElementById("admin-signin").click()');
check('admin: the EVENT TOP-20 tab lists PRELIMINARY with the candidates', await until(async () => /EVENT TOP-20 · PRELIMINARY/.test(await A.ev('document.getElementById("view").textContent')) && (await A.ev('document.querySelectorAll("#ev-candidates tbody tr").length')) >= 20));
const rowOf = w => `#ev-candidates tr[data-wallet="${w}"]`;
const clickIn = (sel, label) => A.ev(`[...document.querySelector(${JSON.stringify(sel)}).querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
const noteOf = () => A.ev('document.getElementById("ev-note")?.textContent || ""');
await A.shot('admin-event-desktop');
check('admin: RU and BY rows say "play only – no prizes"; others "eligible"', (await A.ev(`document.querySelector('${rowOf(byTag.ru.wallet)}').textContent`)).includes('RU · play only – no prizes') && (await A.ev(`document.querySelector('${rowOf(byTag.by.wallet)}').textContent`)).includes('BY · play only – no prizes') && (await A.ev(`document.querySelector('${rowOf(byTag.p0.wallet)}').textContent`)).includes('KZ · eligible') && (await A.ev(`document.querySelector('${rowOf(byTag.eu.wallet)}').textContent`)).includes('DE · no prizes (list / unknown)'));
check('admin: the shared-subnet pair is flagged on both rows', /shares a subnet with/.test(await A.ev(`document.querySelector('${rowOf(byTag.p5.wallet)}').textContent`)) && /shares a subnet with/.test(await A.ev(`document.querySelector('${rowOf(byTag.p6.wallet)}').textContent`)));
check('admin: LOCK is disabled before the appeals end', (await A.ev('document.getElementById("ev-lock").disabled')) === true);

// sanctions: the SNCT wallet is NOT CLEAN, a normal one is clean (mocked port)
await clickIn(rowOf(byTag.snct.wallet), 'CHECK SANCTIONS');
check('sanctions (mocked): the SNCT wallet is NOT CLEAN', await until(async () => /NOT CLEAN/.test(await A.ev(`document.querySelector('${rowOf(byTag.snct.wallet)}')?.textContent || ""`))));
await clickIn(rowOf(byTag.p0.wallet), 'CHECK SANCTIONS');
check('sanctions (mocked): a normal wallet is clean and fresh', await until(async () => /clean · .*fresh/.test(await A.ev(`document.querySelector('${rowOf(byTag.p0.wallet)}')?.textContent || ""`))));
check('sanctions: signed for exactly that wallet', (await A.ev('window.__lastMessage || ""')).includes(byTag.p0.wallet));

// review flags: disqualify p1 with a note; remove the prize of p4
await A.ev(`document.querySelector('${rowOf(byTag.p1.wallet)} input').value = 'e2e: duplicate account'`);
await clickIn(rowOf(byTag.p1.wallet), 'DISQUALIFY');
check('review: DISQUALIFY drops the wallet to rank "–" and offers RESTORE', await until(async () => { const t = await A.ev(`document.querySelector('${rowOf(byTag.p1.wallet)}')?.className + '|' + (document.querySelector('${rowOf(byTag.p1.wallet)}')?.textContent || '')`); return /^dq\|/.test(t) && /RESTORE/.test(t); }));
check('review: the note round-trips into the input', (await A.ev(`document.querySelector('${rowOf(byTag.p1.wallet)} input').value`)) === 'e2e: duplicate account');
await clickIn(rowOf(byTag.p4.wallet), 'REMOVE PRIZE');
check('review: REMOVE PRIZE marks the geo cell', await until(async () => /prize removed/.test(await A.ev(`document.querySelector('${rowOf(byTag.p4.wallet)}')?.textContent || ""`))));
await A.shot('admin-event-reviewed');

// prize table: a bad one is explained without a signature, a valid one is signed
const signedBefore = await A.ev('window.__signed');
await A.ev('document.getElementById("ev-table").value = "100, abc"; document.getElementById("ev-table-save").click()');
check('prize table: nonsense is explained and nothing is signed', await until(async () => /1 to 20 whole/.test(await noteOf())) && (await A.ev('window.__signed')) === signedBefore);
await A.ev('document.getElementById("ev-table").value = "20000,10000,5000,2500,1250,1000,1000,1000,1000,1000,500,500,500,500,500,500,500,500,500,500"; document.getElementById("ev-table-save").click()');
check('prize table: SIGN & SAVE shows "custom table"', await until(async () => /custom table/.test(await A.ev('document.getElementById("view").textContent'))), await noteOf());
check('admin: the header line states prizes now + organizer share', /Prizes now: \$\d+\.\d\d · stays with the organizer: \$\d+\.\d\d/.test(await A.ev('document.querySelector("#view p.dim").textContent')), await A.ev('document.querySelector("#view p.dim").textContent'));
await size(A, 390, 844, true); await sleep(400);
await A.shot('admin-event-phone');
const overflowA = await A.ev('document.documentElement.scrollWidth - document.documentElement.clientWidth');
check('admin phone 390 px: only the tables scroll (the page does not)', overflowA <= 0, String(overflowA));
await size(A, 1500, 1000, false);

// ── the appeals end passes: lock
await schedule(now - 50, now - 10);
await A.ev('document.getElementById("refresh").click()');
check('admin: the lock button opens after the appeals end', await until(async () => (await A.ev('document.getElementById("ev-lock").disabled')) === false));
const signedBeforeLock = await A.ev('window.__signed');
await A.ev('document.getElementById("ev-lock").click()');
check('lock: the list is LOCKED and the FINAL LIST has rows', await until(async () => /EVENT TOP-20 · FINAL · LOCKED/.test(await A.ev('document.getElementById("view").textContent')) && (await A.ev('document.querySelectorAll("#ev-winners tbody tr").length')) > 0), await noteOf());
check('lock: signed once', (await A.ev('window.__signed')) === signedBeforeLock + 1);
check('lock: the review inputs and the table are frozen', (await A.ev('document.getElementById("ev-table").disabled && [...document.querySelectorAll("#ev-candidates tbody tr button:not([data-act])")].every(b => b.disabled)')) === true);
const winners = await A.ev('[...document.querySelectorAll("#ev-winners tbody tr")].map(tr => [tr.dataset.wallet, tr.children[2].textContent])');
check('lock: disqualified / prize-removed / RU / BY wallets are not on the list', !winners.some(([w]) => [byTag.p1.wallet, byTag.p4.wallet, byTag.ru.wallet, byTag.by.wallet].includes(w)), String(winners.length));
check('lock: the first place carries the saved table ($200.00)', winners[0]?.[1] === '$200.00', JSON.stringify(winners[0]));
await A.ev('document.getElementById("ev-winners").scrollIntoView()');
await A.shot('admin-event-locked');

// payouts: a bad signature is explained; SNCT is refused; a clean checked wallet is recorded
const w0 = byTag.p0.wallet, wSn = byTag.snct.wallet;
const payIn = w => `#ev-winners tr[data-wallet="${w}"]`;
await A.ev(`(() => { const r = document.querySelector('${payIn(w0)}'); r.querySelector('input').value = 'not-a-signature'; r.querySelector('button').click(); })()`);
check('payout: a malformed transaction signature is explained', await until(async () => /not a Solana transaction signature/.test(await noteOf())));
const tx = bs58.encode(randomBytes(64));
check('payout: the SNCT wallet holds a paid place', winners.some(([w]) => w === wSn));
await A.ev(`(() => { const r = document.querySelector('${payIn(wSn)}'); r.querySelector('input').value = ${JSON.stringify(tx)}; r.querySelector('button').click(); })()`);
check('payout: the sanctions-listed wallet is refused and the page says why', await until(async () => { const n = await noteOf(); return n && !/Sign in your wallet/.test(n) && !/done/.test(n) && !/not a Solana/.test(n); }), await noteOf());
await A.ev(`(() => { const r = document.querySelector('${payIn(w0)}'); r.querySelector('input').value = ${JSON.stringify(tx)}; r.querySelector('button').click(); })()`);
check('payout: a fresh clean wallet is recorded with a Solscan link', await until(async () => (await A.ev(`document.querySelector('${payIn(w0)} a[href^="https://solscan.io/tx/"]')?.textContent || ""`)).startsWith('✓')), await noteOf());
await A.shot('admin-event-paid');

// ── public final table
p = await profile('en', 1100, 1200, false, 'profile-final-en');
check('public EN (final): "EVENT RESULTS", final note, places start at 1 (not the overall rank), one transaction link', (await V.ev('document.querySelector("#event-board-table tbody tr td").textContent')) === '1' && p.text === 'EVENT RESULTS' && /Final list/.test(p.box) && (await V.ev('document.querySelectorAll("#event-board a[href^=\\"https://solscan.io/tx/\\"]").length')) === 1, p.text);
const finalBoard = await (await fetch(`${BASE}/api/event/board`)).json();
check('API (final): only the locked paid places, amounts follow the saved table, the paid row carries its Solscan URL', finalBoard.phase === 'final' && finalBoard.rows.every(r => r.prizeEligible) && finalBoard.rows[0].amountCents === 20000 && finalBoard.rows.filter(r => r.solscanUrl).length === 1, `${finalBoard.phase} ${finalBoard.rows.slice(0, 4).map(r => r.amountCents)}`);
p = await profile('ru', 1100, 1200, false, 'profile-final-ru');
check('public RU (final): ИТОГИ СОБЫТИЯ + translated final note + link text', p.text === 'ИТОГИ СОБЫТИЯ' && /Итоговый список/.test(p.box) && /транзакция/.test(p.box), p.text);
p = await profile('en', 390, 844, true, 'profile-final-phone-en');
check('phone 390 px (final): no sideways page scroll', p.overflow <= 0, `overflow ${p.overflow}`);
p = await profile('ru', 390, 844, true, 'profile-final-phone-ru');
check('phone 390 px (final, RU): no sideways page scroll', p.overflow <= 0, `overflow ${p.overflow}`);

await cleanup();
await prisma.$disconnect();
if (fails.length) { console.log(`\n${fails.length} failed: ${fails.join('; ')}`); process.exit(1); }
console.log('\nevent surfaces ok; screenshots in', process.env.SHOTS || '$TMPDIR/fc-event-shots');
process.exit(0);
