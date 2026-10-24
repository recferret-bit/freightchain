// Weekly 1h grant and ride-promo precedence, in headless Chrome, against the real handlers.
// As-built: there is no TicketSource 'weekly' and no freeRideCredits. GET /api/me issues a WeeklyTicket row
// (eligible 18+ wallet, allowed country). A `--ride 1h` promo grant is claimed before that ticket.
// The server must be started with PRIZE_DEV_DEFAULT_COUNTRY=KP. A missing country then becomes KP and does not grant.
//   BASE=http://127.0.0.1:3103 CHROME_PORT=9233 DATABASE_URL=… node scripts/e2e-weekly-ticket.mjs
import { execFileSync } from 'node:child_process';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PrismaClient } from '@prisma/client';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:3103';
const PORT = +(process.env.CHROME_PORT || 9233);
const SERVER = new URL('..', import.meta.url).pathname;
const CLI = process.env.CLI || 'dist/cli/index.js';
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const until = async (fn, ms = 25000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
const pageErrors = (h) => h.filt().filter((p) => /^(EXCEPTION|console\.error|log\.error|EVAL)/.test(p));

async function call(method, path, { body, cookie, headers } = {}) {
  const r = await fetch(`${BASE}/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, j: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
async function signIn() {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const { j } = await call('POST', 'auth/nonce', { body: { wallet } });
  const res = await call('POST', 'auth/verify', { body: { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) } });
  return { wallet, cookie: res.cookie };
}

const prisma = new PrismaClient();
const tab = await launch({ port: PORT, shotsDir: 'fc-weekly-shots', evalProblems: true });
try {
  const who = await signIn();
  const agreed = await call('PUT', 'profile/agreements', { body: { age18: true, loss: true }, cookie: who.cookie });
  check('profile is 18+ and the loss offer is on', agreed.status === 200 && agreed.j.age18 === true && agreed.j.loss === true, JSON.stringify(agreed.j));
  const missing = await call('GET', 'me', { cookie: who.cookie });
  check('missing country does not grant when the dev default is KP', missing.status === 200 && (missing.j.weeklyTickets ?? []).length === 0, JSON.stringify(missing.j.weeklyTickets));
  const kp = await call('GET', 'me', { cookie: who.cookie, headers: { 'X-FC-Country': 'KP' } });
  check('an explicit KP country does not grant', kp.status === 200 && (kp.j.weeklyTickets ?? []).length === 0, JSON.stringify(kp.j.weeklyTickets));
  const us = await call('GET', 'me', { cookie: who.cookie, headers: { 'X-FC-Country': 'US' } });
  check('US header grants a live 1h weekly ticket', us.status === 200 && us.j.weeklyTickets?.some((t) => t.tier === '1h' && t.rideId == null), JSON.stringify(us.j.weeklyTickets));
  const granted = await prisma.weeklyTicket.findFirst({ where: { wallet: who.wallet, tier: '1h', rideId: null } });
  check('DB has an unspent WeeklyTicket (no source column; the grant is the row)', !!granted, granted ? granted.tier : 'none');

  await tab.send('Network.enable');
  await tab.send('Network.setExtraHTTPHeaders', { headers: { 'X-FC-Country': 'US' } });
  const [name, value] = who.cookie.split('=');
  await tab.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await tab.send('Page.navigate', { url: `${BASE}/lobby.html#new` });
  check('lobby chip shows the weekly 1h grant', await until(async () => /weekly 1h/.test(await tab.ev('document.getElementById("chip-free")?.textContent || ""'))), await tab.ev('document.getElementById("chip-free")?.textContent || ""'));

  const code = `W3${Date.now().toString(36).toUpperCase()}`;
  execFileSync('node', [CLI, 'promo:create', code, '--ride', '1h', '--desc', 'lane3 weekly precedence'], {
    cwd: SERVER, env: { ...process.env, NODE_ENV: 'development' }, stdio: 'inherit',
  });
  await tab.ev('location.hash = "#profile"');
  check('promo form is up', await until(async () => await tab.ev('!!document.getElementById("promo-code")')));
  await tab.ev(`document.getElementById("promo-code").value = ${JSON.stringify(code)}; document.getElementById("promo-go").click()`);
  check('lobby redeems the 1h ride promo', await until(async () => /One free 1h ride/.test(await tab.ev('document.getElementById("promo-msg")?.textContent || ""'))), await tab.ev('document.getElementById("promo-msg")?.textContent || ""'));

  const first = await tab.ev(`(async () => { const r = await fetch('/api/rides', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier: '1h' }) }); const j = await r.json(); return { status: r.status, id: j.id, promo: j.promo === true, weeklyGrant: j.weeklyGrant === true, tier: j.tier, code: j.code ?? null, detail: j.detail ?? null }; })()`);
  check('ride 1 is the promo shift, not the weekly ticket', first?.status === 200 && first.tier === '1h' && first.promo === true && first.weeklyGrant === false, JSON.stringify(first));
  const still = first?.id ? await prisma.weeklyTicket.findFirst({ where: { wallet: who.wallet, tier: '1h' } }) : null;
  check('the weekly row is still unspent after the promo ride', still?.rideId == null, JSON.stringify(still));
  const started = await call('POST', `rides/${first.id}/start`, { cookie: who.cookie, body: {} });
  check('ride 1 starts', started.status === 200 && started.j.status === 'running', `${started.status} ${started.j.status || started.j.code}`);
  const ended = await call('POST', `rides/${first.id}/end`, { cookie: who.cookie, body: { outcome: 'failed', reason: 'lane3 close the promo ride' } });
  check('ride 1 is closed so the wallet can order again', ended.status === 200 && ended.j.status === 'failed', `${ended.status} ${ended.j.status || ended.j.code} ${ended.j.detail || ''}`);

  const second = await tab.ev(`(async () => { const r = await fetch('/api/rides', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier: '1h' }) }); const j = await r.json(); return { status: r.status, id: j.id, promo: j.promo === true, weeklyGrant: j.weeklyGrant === true, code: j.code ?? null, detail: j.detail ?? null }; })()`);
  check('ride 2 consumes the weekly ticket', second?.status === 200 && second.weeklyGrant === true && second.promo === false, JSON.stringify(second));
  const spent = second?.id ? await prisma.weeklyTicket.findFirst({ where: { wallet: who.wallet, tier: '1h' } }) : null;
  check('DB weekly ticket rideId is ride 2', spent?.rideId === second?.id, JSON.stringify({ rideId: spent?.rideId, id: second?.id }));
  const row = second?.id ? await prisma.ride.findUnique({ where: { id: second.id } }) : null;
  check('ride 2 row is weeklyGrant and not a promo', row?.weeklyGrant === true && row?.promoCode == null, JSON.stringify({ weeklyGrant: row?.weeklyGrant, promoCode: row?.promoCode }));
  const errors = pageErrors(tab);
  check('no page or console errors', errors.length === 0, errors.join(' | '));
  await tab.shot('weekly-done');
} finally {
  await prisma.$disconnect().catch(() => {});
  await tab.close();
}
if (fails.length) { console.error(`FAILED ${fails.length}: ${fails.join(', ')}`); process.exit(1); }
console.log('e2e-weekly-ticket passed');
process.exit(0);
