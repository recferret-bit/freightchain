import { acceptLocalTestTerms } from './local-test-terms.mjs';
// The WHOLE promo loop in real headless Chrome against a RUNNING server (PostgreSQL, the built landing): the admin makes a free-ride code and a ticket code on the admin page (the wallet signs each one),
// different players redeem them from the lobby and from the landing, see what changed (free rides, tickets), then burn TEN4 for cab parts. The admin sees who used what – and the ways a code stops
// working (expired, not started, used up, disabled, already redeemed) and is abused (spelling variants, double clicks, parallel wallets racing for the last use, hostile text).
//   Server: FREE_RIDE_SECONDS=3 ADMIN_WALLETS=<admin address> THROTTLE_PROMO_LIMIT=100000 … node dist/main.js – easiest: `bash .claude/skills/run-tests/e2e.sh promo` (admin keypair + a live 1h pool seeded).
//   ADMIN_KEYPAIR=<path to a JSON array secret key> BASE=http://localhost:<port> [SEED=1 DATABASE_URL=… to seed the 1h pool] CHROME_PORT=<first of three DevTools ports> node scripts/e2e-promo.mjs
// No wallet extension: keypairs sign (a fake Phantom in the admin page and the landing page, session cookies handed to the lobby). Screenshots in $SHOTS – LOOK at them.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://localhost:3111', CDP = +(process.env.CHROME_PORT || 9361);
const fails = []; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const call = async (method, p, b, c, extra = {}) => { const r = await fetch(`${BASE}/api/${p}`, { method, headers: { 'content-type': 'application/json', ...(c && { cookie: c }), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) }); return { r, j: await r.json().catch(() => ({})) }; };
const post = (p, b, c, extra) => call('POST', p, b, c, extra), get = (p, c) => call('GET', p, undefined, c);
/** Test-only ledger credit. The product has no credit route. `honk` is whole TEN4. */
async function creditHonk(wallet, honk) {
  const prisma = new PrismaClient();
  const amount = BigInt(honk) * 1_000_000n, updatedAt = new Date();
  try {
    await prisma.honkAccount.upsert({
      where: { wallet },
      create: { wallet, balance: amount, minted: 0n, burned: 0n, updatedAt },
      update: { balance: { increment: amount }, updatedAt },
    });
  } finally { await prisma.$disconnect(); }
}
const sign = (kp, text) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(text), kp.secretKey));
async function signIn(kp = nacl.sign.keyPair()) {
  const address = bs58.encode(kp.publicKey), { j } = await post('auth/nonce', { wallet: address });
  const { r } = await post('auth/verify', { wallet: address, signature: sign(kp, j.message) });
  return { kp, address, short: `${address.slice(0, 4)}…${address.slice(-4)}`, cookie: await acceptLocalTestTerms(BASE, r.headers.get('set-cookie').split(';')[0]) };
}
async function adminSignIn(kp) {
  const address = bs58.encode(kp.publicKey), h = { 'x-fc-admin': '1' };
  const { j } = await post('admin/auth/nonce', { wallet: address }, undefined, h);
  const { r } = await post('admin/auth/verify', { wallet: address, signature: sign(kp, j.message) }, undefined, h);
  return r.headers.get('set-cookie')?.split(';')[0] ?? '';
}
/* a fake Phantom (window.solana) holding THIS keypair: WebCrypto ed25519 from the nacl secret key (seed = its first 32 bytes) – the server verifies real signatures */
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
})();`;
const until = async (fn, ms = 20000) => { for (let i = 0; i <= ms / 250; i++) { const v = await fn(); if (v) return v; await sleep(250); } return false; };   // counts polls, not wall time
async function login(h, w, url) { await h.send('Network.clearBrowserCookies'); const [n, v] = w.cookie.split('='); await h.send('Network.setCookie', { name: n, value: v, url: BASE, httpOnly: true }); await h.send('Page.navigate', { url }); }
const size = (h, w, hgt, mobile) => h.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile });
const txt = (h, sel) => h.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
const T = Math.random().toString(36).slice(2, 6).toUpperCase();   // codes are prefixed so a re-run against the same database makes new ones
const C = n => `${T}-${n}`;

if (process.env.SEED === '1') {   // the live 1h pool the TICKETS code puts tickets into (dev-only seeds through the admin CLI; "already exists" is fine)
  try { execFileSync('node', ['dist/cli/index.js', 'pool:seed', '--id', '1', '--tier', '1h', '--status', 'active', '--min', '2'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' }); } catch { /* exists */ }
}

const adminKp = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR, 'utf8'))));
const adminPlayer = await signIn(adminKp), adminCookie = await adminSignIn(adminKp);
/** a signed create / disable straight over the API (the page does the same three steps) – for what a form cannot say: a code that ends in 12 s */
async function adminDo(action, body) {
  const h = { 'x-fc-admin': '1' };
  const { j } = await post('admin/promos/challenge', { action, ...body }, adminCookie, h);
  const signature = sign(adminKp, j.message);
  return action === 'promo_create' ? post('admin/promos', { promo: body.promo, signature }, adminCookie, h) : post(`admin/promos/${body.code}/disable`, { signature }, adminCookie, h);
}
const promoBody = (code, effect, over = {}) => ({ code, effect, description: null, maxRedemptions: null, perWallet: 1, startsAt: null, expiresAt: null, note: null, ...over });

const A = await launch({ port: CDP, shotsDir: 'fc-promo-shots', evalProblems: true });   // the admin page
const B = await launch({ port: CDP + 1, shotsDir: 'fc-promo-shots', evalProblems: true });   // the lobby, as one player after another
const L = await launch({ port: CDP + 2, shotsDir: 'fc-promo-shots', evalProblems: true });   // the landing
await size(A, 1200, 1000, false); await size(B, 1100, 900, false); await size(L, 1280, 900, false);
// Chrome logs every refused fetch: only the refusals this suite provokes on purpose are fine
const expected = p => /status of (400|401|404|409)/.test(p) && /\/api\/(promo\/redeem|admin\/|me\b)/.test(p);
const problems = h => h.filt().filter(p => !expected(p) && !/404/.test(p));

// ═══ 1 · the admin makes one code of every kind on the page – the wallet signs each ═══════════════════════════════════
await A.send('Page.addScriptToEvaluateOnNewDocument', { source: fakeWallet(adminKp) });
await login(A, adminPlayer, `${BASE}/admin.html#overview`);
await until(async () => await A.ev('!!document.getElementById("admin-signin")')); await A.ev('document.getElementById("admin-signin").click()');
await until(async () => await A.ev(`!!document.querySelector('[data-fc-wallets] button')`), 8000);
await A.ev(`[...document.querySelectorAll('[data-fc-wallets] button')].find(b => (b.textContent || '').startsWith('Phantom'))?.click()`);
check('admin: signed in and the overview is up', await until(async () => (await A.ev('document.querySelectorAll(".tile").length')) === 6, 30000), await A.ev('(document.body.innerText || "").slice(0, 180)'));
await A.ev('location.hash = "#promos"');
check('admin: the PROMO CODES tab opens', await until(async () => await A.ev('!!document.getElementById("promo-form")')));
const setField = (id, v) => A.ev(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const listed = code => A.ev(`!![...document.querySelectorAll('#promo-table tr')].find(r => r.dataset.code === ${JSON.stringify(code)})`);
/** one trip through the form: fields → SIGN & CREATE → the code is listed */
async function create(code, fields, gives) {
  const signedBefore = await A.ev('window.__signed');
  await setField('pf-code', code); await setField('pf-desc', ''); await setField('pf-max', ''); await setField('pf-per', '1');
  for (const [id, v] of Object.entries(fields)) await setField(id, v);
  await A.ev('document.getElementById("promo-form").requestSubmit()');
  const ok = await until(async () => await listed(code.replace(/[\s]/g, '').toUpperCase()));
  const signedText = await A.ev('window.__lastMessage || ""');
  check(`admin: ${gives} → ${code.toUpperCase()} is created, listed, and the wallet signed exactly it`, ok && (await A.ev('window.__signed')) === signedBefore + 1 && signedText.includes(`Action: CREATE promo code ${code.replace(/\s/g, '').toUpperCase()}`) && signedText.includes(`Gives: ${gives}`), signedText.split('\n').slice(0, 3).join(' | '));
}
const EVIL = '<img src=x onerror="window.__xss=1">';
await create(C('RIDE1'), { 'pf-kind': 'ride', 'pf-ride': '1h', 'pf-desc': EVIL }, 'one free 1h ride (not for sale)');
await create(C('RIDE3'), { 'pf-kind': 'tickets', 'pf-tier': '1h', 'pf-credits': '1', 'pf-max': '2', 'pf-desc': 'One ticket, two players' }, '1 × 1h ride ticket');
await create(C('TICKETS'), { 'pf-kind': 'tickets', 'pf-tier': '1h', 'pf-credits': '2', 'pf-desc': 'Two 1-hour tickets' }, '2 × 1h ride tickets');
const PARTS = [['wheel', 'gold'], ['truck_color', 'blue'], ['gearbox', 'chrome'], ['dice', 'pink'], ['needle', 'cyan']];
check('admin: the effect menu has no cab-colour kind', (await A.ev('[...document.getElementById("pf-kind").options].map(o => o.value).join(",")')) === 'ride,tickets');
const table = await A.ev('document.getElementById("promo-table").textContent');
check('admin: the ACTIVE list shows the three codes, what each gives, 0 uses', [C('RIDE1'), C('RIDE3'), C('TICKETS')].every(c => table.includes(c)) && (table.match(/ACTIVE/g) || []).length >= 3 && /one free 1h ride/.test(table) && /2 × 1h ride tickets/.test(table), table.slice(0, 200));
check('admin: the description with HTML in it is shown as TEXT, nothing was injected', (await A.ev('!!document.querySelector("#promo-table img")')) === false && (await A.ev('window.__xss')) === undefined && table.includes('<img src=x'));
await A.shot('admin-promos-created');

// ═══ 2 · players use them in the lobby, and see the changes ═══════════════════════════════════════════════════════════
const u1 = await signIn(), u2 = await signIn(), u3 = await signIn();
const lobbyAs = async (w, hash = '') => { await login(B, w, `${BASE}/lobby.html${hash}`); return until(async () => /training · unlimited/.test(await txt(B, '#chip-free'))); };
const held = async cookie => ((await get('me', cookie)).j.tickets ?? []).reduce((n, t) => n + Number(t.balance || 0), 0);
/** open the PROFILE, type a code into its field and press REDEEM; resolves with the message and whether it was shown as good or bad */
async function redeemUI(code) {
  await B.ev('if (location.hash !== "#profile" && location.hash !== "#promo") location.hash = "#profile"'); await until(async () => await B.ev('!!document.getElementById("promo-code")'));
  await B.ev(`(() => { const i = document.getElementById('promo-code'); i.value = ${JSON.stringify(code)}; })()`);
  await B.ev('document.getElementById("promo-msg").textContent = ""; document.getElementById("promo-go").click()');
  await until(async () => { const t = await txt(B, '#promo-msg'); return t && !/Redeeming/.test(t); });
  return { text: await txt(B, '#promo-msg'), good: await B.ev('document.getElementById("promo-msg").classList.contains("good")') };
}
check('lobby (player 1): signed in, training stays unlimited', await lobbyAs(u1) && /training · unlimited/.test(await txt(B, '#chip-free')), await txt(B, '#chip-free'));
let r = await redeemUI(` ${C('ride3').toLowerCase().replace('-', ' - ')} `);
check('lobby: a lower-case code with spaces redeems one ticket and training stays unlimited', r.good && /\+1 ticket/.test(r.text) && /training · unlimited/.test(await txt(B, '#chip-free')), r.text);
r = await redeemUI(C('RIDE3'));
check('lobby: the same code again is refused (already redeemed) and training stays unlimited', !r.good && /already redeemed/.test(r.text) && /training · unlimited/.test(await txt(B, '#chip-free')), r.text);
for (const again of [C('ride3'), ` ${C('RIDE3')}\t`, C('Ride3')]) { r = await redeemUI(again); if (r.good) break; }
check('lobby: spelling it differently does not give a second one', !r.good && /training · unlimited/.test(await txt(B, '#chip-free')) && (await held(u1.cookie)) === 1, r.text);
r = await redeemUI(C('TICKETS'));
check('lobby: the TICKETS code puts 2 tickets into the live 1h pool', r.good && /\+2 tickets/.test(r.text) && (await held(u1.cookie)) === 3, r.text);
await creditHonk(u1.address, 520); // gold 260 + four parts at 65
let minted = 0;
for (const [slot, item] of PARTS) { const m = await post('honk/visuals', { slot, item }, u1.cookie); if (m.r.status === 200) minted++; }
check('lobby: burning TEN4 mints the five cab parts', minted === 5 && (await get('honk', u1.cookie)).j.balance === '0', String(minted));
r = await redeemUI(C('RIDE1'));
check('lobby: the 1h ride code works too and training stays unlimited', r.good && /One free 1h ride/.test(r.text) && /training · unlimited/.test(await txt(B, '#chip-free')), r.text);
r = await redeemUI('NO-SUCH-' + T);
check('lobby: an unknown code says so, nothing changes', !r.good && /Unknown promo code/.test(r.text), r.text);
r = await redeemUI('');
check('lobby: an empty field is explained', !r.good && /Type a promo code first/.test(r.text), r.text);
await B.ev('location.hash = "#profile"');
check('lobby PROMO tab: every code this player redeemed is listed with what it gave – the HTML description as plain text', await until(async () => { const t = await txt(B, '#my-codes'); return [C('RIDE1'), C('RIDE3'), C('TICKETS')].every(c => t.includes(c)) && /one free 1h ride/.test(t) && !/wheel: gold/.test(t); }) && (await B.ev('!!document.querySelector("#my-codes img")')) === false && (await txt(B, '#my-codes')).includes('<img src=x'), (await txt(B, '#my-codes')).slice(0, 160));
await B.ev('location.hash = "#garage"');
check('lobby GARAGE: five parts collected (5 / 48), each one worn and saved, the cab canvas draws them', await until(async () => /^COLLECTION5 \/ 48/.test(await txt(B, '#garage-progress'))) && (await B.ev(`['wheel:gold','truck_color:blue','gearbox:chrome','dice:pink','needle:cyan'].every(s => { const [a, b] = s.split(':'); const e = document.querySelector('#garage-slots [data-slot=' + a + '] [data-item=' + b + ']'); return e && e.classList.contains('on') && e.classList.contains('saved'); })`)) === true && (await B.ev('!!document.querySelector("#garage-preview canvas")')) === true, await txt(B, '#garage-progress'));
await B.shot('promo-garage-player1');
const wardrobe = (await get('wardrobe', u1.cookie)).j.equipped;
check('API: the wardrobe of player 1 wears the five minted parts', wardrobe?.wheel === 'gold' && wardrobe?.truck_color === 'blue' && wardrobe?.gearbox === 'chrome' && wardrobe?.dice === 'pink' && wardrobe?.needle === 'cyan', JSON.stringify(wardrobe));

check('lobby (player 2): redeems the 2-use code', await lobbyAs(u2) && (r = await redeemUI(C('RIDE3'))).good && /training · unlimited/.test(await txt(B, '#chip-free')), r?.text);
check('lobby (player 3): the 2-use code is used up – refused, nothing granted, nothing else of player 3 changed', await lobbyAs(u3) && !(r = await redeemUI(C('RIDE3'))).good && /fully redeemed/.test(r.text) && /training · unlimited/.test(await txt(B, '#chip-free')) && (await get('garage', u3.cookie)).j.progress.collected === 0, r.text);
await B.ev('location.hash = "#profile"');
check('lobby PROMO tab of player 3: nothing redeemed', await until(async () => /No codes redeemed yet/.test(await txt(B, '#my-codes'))));
// the API races a script would run (the lobby disables its button while a request is out)
const anon = await Promise.all(Array.from({ length: 4 }, () => post('promo/redeem', { code: C('RIDE1') })));
check('abuse: signed-out redeems are all 401', anon.every(x => x.r.status === 401), anon.map(x => x.r.status).join());
const u2race = await signIn();
const raceCookie = u2race.cookie;
const many = await Promise.all(Array.from({ length: 8 }, () => post('promo/redeem', { code: C('RIDE1') }, raceCookie)));
check('abuse: one wallet firing 8 redeems of a one-per-wallet code at once gets it exactly once', many.filter(x => x.r.status === 200).length === 1 && many.filter(x => x.r.status === 409).length === 7 && (await get('promo/mine', raceCookie)).j.redemptions.filter(x => x.code === C('RIDE1')).length === 1, many.map(x => x.r.status).join());

// ═══ 3 · the landing: the invite block carries a code through the sign-in to the lobby ═══════════════════════════════════
const u4kp = nacl.sign.keyPair();
await L.send('Page.addScriptToEvaluateOnNewDocument', { source: fakeWallet(u4kp) });
await L.send('Page.navigate', { url: `${BASE}/?promo=${C('TICKETS')}` });
check('landing: /?promo=CODE pre-fills the invite block and says the code is ready', await until(async () => (await L.ev('document.getElementById("invite-code")?.value')) === C('TICKETS') && /is ready/.test(await txt(L, '#invite-msg'))), await txt(L, '#invite-msg'));
await L.shot('promo-landing-invite');
await L.ev('document.getElementById("invite").requestSubmit()');
check('landing (signed out): CLAIM keeps the code and takes the player to CONNECT', /saved/.test(await txt(L, '#invite-msg')) && (await L.ev('document.activeElement?.id')) === 'connect', await txt(L, '#invite-msg'));
await L.ev('document.getElementById("connect").click()');
await until(async () => await L.ev(`!![...document.querySelectorAll('[data-fc-wallets] button')].find(b => (b.textContent || '').startsWith('Phantom'))`));
await L.ev(`[...document.querySelectorAll('[data-fc-wallets] button')].find(b => (b.textContent || '').startsWith('Phantom')).click()`);
check('landing → lobby: after the wallet signs, the PROFILE opens with the code typed in – and not redeemed yet', await until(async () => (await L.ev('location.pathname')) === '/lobby.html' && (await L.ev('document.getElementById("promo-code")?.value || ""')).toLowerCase() === C('TICKETS').toLowerCase(), 20000) && (await get('promo/mine', await signInCookie(L))).j.redemptions?.length === 0);
async function signInCookie(h) { const c = (await h.send('Network.getCookies', { urls: [BASE] })).cookies.find(k => k.name === 'fc_session'); return c ? `fc_session=${c.value}` : ''; }
await L.ev('document.getElementById("promo-go").click()');
check('lobby (arrived from the landing): REDEEM works – the ticket code', await until(async () => /\+2 tickets/.test(await txt(L, '#promo-msg'))), await txt(L, '#promo-msg'));
await L.shot('promo-lobby-from-landing');
const landed = await signInCookie(L);
await creditHonk(bs58.encode(u4kp.publicKey), 65);
check('…and burning 65 TEN4 wears the pink dice', (await post('honk/visuals', { slot: 'dice', item: 'pink' }, landed)).r.status === 200 && (await get('wardrobe', landed)).j.equipped.dice === 'pink');
await L.send('Page.navigate', { url: `${BASE}/` });
await until(async () => !(await L.ev('document.getElementById("chip-wallet")?.hidden ?? true')));
await L.ev(`document.getElementById('invite-code').value = ${JSON.stringify(C('RIDE1'))}; document.getElementById('invite').requestSubmit()`);
check('landing (signed in): CLAIM goes straight to the lobby with the code typed in', await until(async () => (await L.ev('location.pathname')) === '/lobby.html' && (await L.ev('document.getElementById("promo-code")?.value')) === C('RIDE1')));
await L.ev('document.getElementById("promo-go").click()');
check('…REDEEM there gives the free 1h ride (landing and lobby are the same flow)', await until(async () => /One free 1h ride/.test(await txt(L, '#promo-msg'))), await txt(L, '#promo-msg'));

// ═══ 4 · time: a code that ends, a code that has not begun, and the one that is used up ═══════════════════════════════
const WINDOW = 14_000, t0 = Date.now();
const shortLived = await adminDo('promo_create', { promo: promoBody(C('SHORT'), { kind: 'ride', tier: '1h' }, { expiresAt: t0 + WINDOW, description: 'ends soon' }) });
const notYet = await adminDo('promo_create', { promo: promoBody(C('SOON'), { kind: 'ride', tier: '1h' }, { startsAt: t0 + WINDOW }) });
check('admin API: a code with an end and a code with a start were created (signed)', shortLived.r.status === 200 && notYet.r.status === 200 && shortLived.j.state === 'active' && notYet.j.state === 'scheduled', `${shortLived.r.status}/${notYet.r.status}`);
const u5 = await signIn(), u6 = await signIn(), u7 = await signIn();
check('time (before the end): the player redeems the short-lived code', await lobbyAs(u5) && (r = await redeemUI(C('SHORT'))).good, r?.text);
check('time (before the start): the not-yet code is refused – "not active yet"', await lobbyAs(u6) && !(r = await redeemUI(C('SOON'))).good && /not active yet/.test(r.text) && /training · unlimited/.test(await txt(B, '#chip-free')), r?.text);
await sleep(Math.max(0, t0 + WINDOW + 1500 - Date.now()));
check('time (after the start): the same player now gets the code that was not active yet', (r = await redeemUI(C('SOON'))).good && /One free 1h ride/.test(r.text) && /training · unlimited/.test(await txt(B, '#chip-free')), r?.text);
check('time (after the end): the short-lived code is refused – "expired" – for a player who never tried it', await lobbyAs(u7) && !(r = await redeemUI(C('SHORT'))).good && /expired/.test(r.text), r?.text);
check('time: what the short-lived code gave player 5 is still there', (await get('promo/mine', u5.cookie)).j.redemptions.some(x => x.code === C('SHORT')));

// ═══ 5 · abuse: ten wallets race for the last use of a code ═══════════════════════════════════════════════════════════
const last = await adminDo('promo_create', { promo: promoBody(C('LAST'), { kind: 'ride', tier: '1h' }, { maxRedemptions: 1 }) });
const racers = await Promise.all(Array.from({ length: 10 }, () => signIn()));
const results = await Promise.all(racers.map(w => post('promo/redeem', { code: C('LAST') }, w.cookie)));
check('abuse: ten wallets, one use left → exactly one 200, nine 409', last.r.status === 200 && results.filter(x => x.r.status === 200).length === 1 && results.filter(x => x.r.status === 409).length === 9, results.map(x => x.r.status).join());
const raceWon = await Promise.all(racers.map(async w => (await get('promo/mine', w.cookie)).j.redemptions.some(x => x.code === C('LAST'))));
check('abuse: …and only the winner got the ride', raceWon.filter(Boolean).length === 1, String(raceWon.filter(Boolean).length));
const hostile = await Promise.all([{}, { code: null }, { code: 5 }, { code: [C('RIDE1')] }, { code: "' OR 1=1 --" }, { code: 'X'.repeat(80) }].map(b => post('promo/redeem', b, racers[0].cookie)));
check('abuse: hostile bodies are 4xx, never a 500', hostile.every(x => x.r.status >= 400 && x.r.status < 500), hostile.map(x => x.r.status).join());

// ═══ 6 · the admin sees it all, then stops a code ═══════════════════════════════════════════════════════════════════════
await A.ev('location.hash = "#promos"'); await A.ev('document.getElementById("refresh").click()');
const state = async s => {   // the filter button is `.on` only after that reload paints; the previous table is still in the page until then
  await until(async () => await A.ev('!!document.getElementById("promo-states")'));
  const sel = `document.querySelector('#promo-states button[data-state=${JSON.stringify(s)}]')`;
  await A.ev(`${sel}?.click()`);
  await until(async () => await A.ev(`${sel}?.classList.contains('on')`));
  return await A.ev('document.getElementById("promo-table")?.textContent || ""');
};
check('admin: the EXHAUSTED filter lists the 2-use code and the last-use code', await until(async () => { const t = await state('exhausted'); return t.includes(C('RIDE3')) && t.includes(C('LAST')); }));
check('admin: the ENDED filter lists the short-lived code (used 1 time)', await until(async () => { const t = await state('ended'); return t.includes(C('SHORT')) && /1/.test(t); }));
check('admin: the ACTIVE filter no longer lists the codes that are used up or ended', await until(async () => { const t = await state('active'); return t.includes(C('RIDE1')) && t.includes(C('SOON')) && !t.includes(C('RIDE3')) && !t.includes(C('SHORT')); }));
await state('exhausted');
await A.ev(`[...document.querySelectorAll("#promo-table a")].find(a => a.textContent === ${JSON.stringify(C('RIDE3'))})?.click()`);
check('admin: USED BY PLAYERS for RIDE3 names both wallets, what they got, nobody else (player 3 was refused)', await until(async () => { const t = await A.ev('document.getElementById("promo-used")?.textContent || ""'); return (await A.ev('document.querySelectorAll("#promo-used tbody tr").length')) === 2 && t.includes(u1.short) && t.includes(u2.short) && !t.includes(u3.short) && (t.match(/1 × 1h ride ticket/g) || []).length === 2; }));
await A.shot('admin-promos-used');
await A.ev('[...document.querySelectorAll("#view a")].find(a => /all redemptions/.test(a.textContent))?.click()');
await until(async () => (await A.ev('document.getElementById("promo-used")?.textContent || ""')).includes(u3.short) === false && (await A.ev('document.querySelectorAll("#promo-used tbody tr").length')) > 8);
await A.ev(`[...document.querySelectorAll("#promo-used a")].find(a => a.title === ${JSON.stringify(u1.address)})?.click()`);
check('admin: filtering by player 1\'s wallet lists the three codes it redeemed, nothing of other wallets', await until(async () => { const t = await A.ev('document.getElementById("promo-used")?.textContent || ""'); return [C('RIDE1'), C('RIDE3'), C('TICKETS')].every(c => t.includes(c)) && !t.includes(u2.short) && (await A.ev('document.querySelectorAll("#promo-used tbody tr").length')) === 3; }));
await A.ev('[...document.querySelectorAll("#view a")].find(a => /all redemptions/.test(a.textContent))?.click()');
await until(async () => !(await A.ev('[...document.querySelectorAll("#view a")].some(a => /all redemptions/.test(a.textContent))')));   // that reload keeps the old state filter; wait before switching to ACTIVE
await state('active');
await until(async () => await A.ev(`!![...document.querySelectorAll("#promo-table tr")].find(r => r.dataset.code === ${JSON.stringify(C('RIDE1'))})`));
await A.ev(`[...document.querySelectorAll("#promo-table tr")].find(r => r.dataset.code === ${JSON.stringify(C('RIDE1'))})?.querySelector("button.reject")?.click()`);
check('admin: DISABLE (signed for exactly this code) takes RIDE1 off the ACTIVE list', await until(async () => !(await A.ev('document.getElementById("promo-table")?.textContent || ""')).includes(C('RIDE1'))) && (await A.ev('window.__lastMessage')).includes(`Action: DISABLE promo code ${C('RIDE1')}`));
const u8 = await signIn();
check('lobby: a player who tries the disabled code is told it is no longer valid, and gets nothing', await lobbyAs(u8) && !(r = await redeemUI(C('RIDE1'))).good && /no longer valid/.test(r.text) && /training · unlimited/.test(await txt(B, '#chip-free')), r?.text);
check('lobby: what the disabled code already gave player 1 stays', (await get('promo/mine', u1.cookie)).j.redemptions.some(x => x.code === C('RIDE1')));
await A.ev('location.hash = "#audit"');
check('admin audit: every create and the disable are logged with their signatures', await until(async () => { const t = await A.ev('document.querySelector("tbody")?.textContent || ""'); return (t.match(/promo\.create/g) || []).length >= 6 && /promo\.disable/.test(t) && /"signature"/.test(t); }));
await size(A, 390, 844, true); await A.ev('location.hash = "#promos"'); await sleep(500); await A.shot('admin-promos-phone');
await size(B, 390, 844, true); await login(B, u1, `${BASE}/lobby.html#garage`); await sleep(2500); await B.shot('promo-garage-phone');

const bad = [...problems(A), ...problems(B), ...problems(L)];
check('no unexpected page errors (admin, lobby, landing)', bad.length === 0, bad.join(' | ').slice(0, 300));
console.log(`screenshots: ${A.SHOTS}`);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
A.finish(fails.length ? 1 : 0);
