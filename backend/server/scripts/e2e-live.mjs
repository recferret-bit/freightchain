import { acceptLocalTestTerms } from './local-test-terms.mjs';
// Live negatives in headless Chrome. As-built codes, not the issue's 400 for both:
//   self-donate  POST /api/watch/:id/donations     → 403 own_ride (LiveAccessService; free rides are free_ride_no_stream first)
//   self-pledge  POST /api/pledges                 → 400 bad_request "sponsor cannot be the driver" (after agreements)
//   chat spam    POST /api/watch/:id/messages      → 429 live_rate_limited (LINE_WINDOW_MS, not the global throttler)
// The driver's watch panel already hides donate/chat and says the ride is their own. The spectator SEND path
// puts the 429 detail in #w-msg and does not throw.
//   BASE=http://127.0.0.1:3103 CHROME_PORT=9233 DATABASE_URL=… node scripts/e2e-live.mjs
import { execFileSync } from 'node:child_process';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:3103';
const PORT = +(process.env.CHROME_PORT || 9233);
const SERVER = new URL('..', import.meta.url).pathname;
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const until = async (fn, ms = 25000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
const expected = (p) => /status of (400|403|429)/.test(p) && /\/api\/(watch|pledges)\b/.test(p);
const pageErrors = (h) => h.filt().filter((p) => /^(EXCEPTION|console\.error|log\.error|EVAL)/.test(p) && !expected(p));

async function call(method, path, { body, cookie } = {}) {
  const r = await fetch(`${BASE}/api/${path}`, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, j: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
async function signIn() {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const { j } = await call('POST', 'auth/nonce', { body: { wallet } });
  const res = await call('POST', 'auth/verify', { body: { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) } });
  return { wallet, cookie: await acceptLocalTestTerms(BASE, res.cookie) };
}
async function openWatch(tab, who, id) {
  await tab.send('Network.enable');
  const [name, value] = who.cookie.split('=');
  await tab.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await tab.send('Page.navigate', { url: `${BASE}/play.html?watch=${id}` });
  return until(async () => await tab.ev('!!document.getElementById("w-me")'), 40000);
}

const driver = await signIn(), fan = await signIn();
const code = `L3${Date.now().toString(36).toUpperCase()}`;
execFileSync('node', ['dist/cli/index.js', 'promo:create', code, '--ride', '1h', '--desc', 'lane3 live negatives'], {
  cwd: SERVER, env: { ...process.env, NODE_ENV: 'development' }, stdio: 'inherit',
});
const agreed = await call('PUT', 'profile/agreements', { body: { age18: true, loss: true }, cookie: driver.cookie });
const redeemed = await call('POST', 'promo/redeem', { body: { code }, cookie: driver.cookie });
const ordered = await call('POST', 'rides', { body: { tier: '1h' }, cookie: driver.cookie });
const started = ordered.j?.id ? await call('POST', `rides/${ordered.j.id}/start`, { body: {}, cookie: driver.cookie }) : { status: 0, j: {} };
if (agreed.status !== 200 || redeemed.status !== 200 || started.status !== 200) {
  console.error('setup failed', JSON.stringify({ agreed: agreed.status, redeemed: { status: redeemed.status, body: redeemed.j }, ordered: ordered.j, started }));
  process.exit(1);
}
const rideId = ordered.j.id;

const tab = await launch({ port: PORT, shotsDir: 'fc-live-shots', evalProblems: true, timeoutMs: 60000 });
try {
  check('driver watch page is up', await openWatch(tab, driver, rideId));
  check('the panel tells the driver spectators write here', await until(async () => /your own ride/.test(await tab.ev('document.getElementById("w-me")?.textContent || ""'))), await tab.ev('document.getElementById("w-me")?.textContent || ""'));
  const donate = await tab.ev(`(async () => { const r = await fetch('/api/watch/${rideId}/donations', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ effect: 'tip' }) }); const j = await r.json(); const p = document.createElement('p'); p.id = 'w-self-donate'; p.textContent = r.status + ' ' + (j.code || '') + ': ' + (j.detail || ''); document.getElementById('w-me').append(p); return { status: r.status, code: j.code, detail: j.detail || '' }; })()`);
  check('self-donate is 403 own_ride (as-built; the issue said 400)', donate?.status === 403 && donate.code === 'own_ride', JSON.stringify(donate));
  const donateText = await tab.ev('document.getElementById("w-self-donate")?.textContent || ""');
  check('the driver page shows that refusal', /403 own_ride/.test(donateText), donateText);
  const pledge = await tab.ev(`(async () => { const r = await fetch('/api/pledges', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rideId: ${JSON.stringify(rideId)}, lamportsPerKm: '1000', targetKm: 1 }) }); const j = await r.json(); const p = document.createElement('p'); p.id = 'w-self-pledge'; p.textContent = r.status + ' ' + (j.code || '') + ': ' + (j.detail || ''); document.getElementById('w-me').append(p); return { status: r.status, code: j.code, detail: j.detail || '' }; })()`);
  check('self-pledge is 400 bad_request', pledge?.status === 400 && pledge.code === 'bad_request' && /sponsor cannot be the driver/.test(pledge.detail || ''), JSON.stringify(pledge));
  await tab.shot('live-driver');

  check('spectator watch page is up', await openWatch(tab, fan, rideId));
  check('spectator can write', await until(async () => await tab.ev('!!document.getElementById("w-text")')));
  await tab.ev('document.getElementById("w-text").value = "lane3 one"; [...document.querySelectorAll("#w-me button")].find(b => b.textContent === "SEND").click()');
  check('the first line is accepted', await until(async () => /lane3 one/.test(await tab.ev('document.getElementById("watch")?.textContent || ""'))));
  await tab.ev(`(() => { const orig = window.fetch.bind(window); window.__hits = []; window.fetch = async (...args) => { const r = await orig(...args); const url = String(args[0]); if (url.includes('/messages')) { const j = await r.clone().json().catch(() => ({})); window.__hits.push({ status: r.status, code: j.code || null, detail: j.detail || '' }); } return r; }; })()`);
  await tab.ev('document.getElementById("w-text").value = "lane3 two"; [...document.querySelectorAll("#w-me button")].find(b => b.textContent === "SEND").click()');
  check('the SEND button shows the rate-limit sentence', await until(async () => /one line per 3 s/.test(await tab.ev('document.getElementById("w-msg")?.textContent || ""'))), await tab.ev('document.getElementById("w-msg")?.textContent || ""'));
  const spam = await tab.ev('window.__hits && window.__hits[0]');
  check('chat spam is 429 live_rate_limited', spam?.status === 429 && spam.code === 'live_rate_limited', JSON.stringify(spam));
  const errors = pageErrors(tab);
  check('no unhandled page errors', errors.length === 0, errors.join(' | '));
  await tab.shot('live-fan');
} finally {
  await tab.close();
  if (started.status === 200) await call('POST', `rides/${rideId}/end`, { cookie: driver.cookie, body: { outcome: 'failed', reason: 'lane3 live done' } }).catch(() => {});
}
if (fails.length) { console.error(`FAILED ${fails.length}: ${fails.join(', ')}`); process.exit(1); }
console.log('e2e-live passed');
process.exit(0);
