// Achievement progress in real headless Chrome. The catalogue id is on-my-own-2 (solo ladder): completed free rides without assist.
// A verdict of rejected drops that completion (and its metres) while VERDICT_ENFORCE is on. Starting still counts — first-mile reads starts, not the verdict.
// Server: FREE_RIDE_SECONDS=3 TRAFFIC_PROOF_REQUIRED=false (a missing recording must not reject the two rides that should count).
//   BASE=http://localhost:3104 CHROME_PORT=9234 DATABASE_URL=… node scripts/e2e-achievements.mjs
import { PrismaClient } from '@prisma/client';
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://localhost:3111';
const CDP = +(process.env.CHROME_PORT || process.env.PORT || 9234);
const fails = [];
const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const post = async (p, b, c) => { const r = await fetch(`${BASE}/api/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(c && { cookie: c }) }, body: JSON.stringify(b) }); return { r, j: await r.json().catch(() => ({})) }; };
const get = async (p, c) => { const r = await fetch(`${BASE}/api/${p}`, { headers: c ? { cookie: c } : {} }); return { r, j: await r.json().catch(() => ({})) }; };
async function wallet() {
  const kp = nacl.sign.keyPair(), address = bs58.encode(kp.publicKey), { j } = await post('auth/nonce', { wallet: address });
  const { r } = await post('auth/verify', { wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) });
  return { address, cookie: r.headers.get('set-cookie').split(';')[0] };
}
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
const progress = (profile, id) => profile.achievements.find(a => a.id === id)?.progress;
async function finishFree(cookie) {
  const created = await post('rides', { tier: 'free', level: 1, assist: false, tutorial: false }, cookie);
  if (!created.r.ok) throw new Error(`create ${created.r.status} ${JSON.stringify(created.j)}`);
  const ride = created.j;
  const started = await post(`rides/${ride.id}/start`, {}, cookie);
  if (!started.r.ok) throw new Error(`start ${started.r.status} ${JSON.stringify(started.j)}`);
  const metres = Math.ceil(ride.completeDist) + 1;
  const wait = Math.max(1200, Math.ceil(((metres - 20) / (28 * 1.2)) * 1000) + 300);
  if (wait > 20000) throw new Error(`finish line is ${ride.completeDist} m — set FREE_RIDE_SECONDS=3`);
  await sleep(wait);
  const ended = await post(`rides/${ride.id}/end`, { outcome: 'shift', s: metres, t: ride.minSeconds, hull: 100 }, cookie);
  if (!ended.r.ok || ended.j.status !== 'completed') throw new Error(`end ${ended.r.status} ${JSON.stringify(ended.j)}`);
  return ended.j;
}
async function reject(rideId) {
  const prisma = new PrismaClient();
  try {
    await prisma.rideVerdict.upsert({
      where: { rideId },
      create: { rideId, status: 'rejected', reasons: [{ code: 'recording-gaps', detail: 'e2e: rejected ride must not count' }], scores: {}, rulesVersion: 1, judgedAt: new Date() },
      update: { status: 'rejected', reasons: [{ code: 'recording-gaps', detail: 'e2e: rejected ride must not count' }], overriddenBy: null },
    });
  } finally { await prisma.$disconnect(); }
}

const me = await wallet();
const page = await launch({ port: CDP, shotsDir: 'fc-achievements-shots', evalProblems: true });
await page.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
const [name, value] = me.cookie.split('=');
await page.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
const open = async () => { await page.send('Page.navigate', { url: `${BASE}/lobby.html?v=${Date.now()}#achievements` }); return until(() => page.ev(`!!document.querySelector('[data-id="on-my-own-2"] .pg em')`), 30000); };
const shown = () => page.ev(`document.querySelector('[data-id="on-my-own-2"] .pg em')?.textContent || ''`);

check('the achievements tab renders before any ride', await open());
const none = await get('profile', me.cookie);
check('on-my-own-2 starts at 0 / 5', progress(none.j, 'on-my-own-2')?.value === 0 && progress(none.j, 'on-my-own-2')?.target === 5, JSON.stringify(progress(none.j, 'on-my-own-2')));
check('the lobby shows 0 / 5', (await shown()) === '0 / 5', await shown());

const first = await finishFree(me.cookie);
const mid = await get('profile', me.cookie);
check('one unassisted finish moves on-my-own-2 to 1 / 5 and earns On My Own', progress(mid.j, 'on-my-own-2')?.value === 1 && !!mid.j.achievements.find(a => a.id === 'on-my-own')?.earnedAt, JSON.stringify(progress(mid.j, 'on-my-own-2')));
await open();
check('the lobby shows 1 / 5 after the first finish', (await shown()) === '1 / 5', await shown());
await page.shot('after-one');

const second = await finishFree(me.cookie);
const two = await get('profile', me.cookie);
check('a second finish moves on-my-own-2 to 2 / 5', progress(two.j, 'on-my-own-2')?.value === 2, JSON.stringify(progress(two.j, 'on-my-own-2')));
await open();
check('the lobby shows 2 / 5', (await shown()) === '2 / 5', await shown());

const third = await finishFree(me.cookie);
await reject(third.id);
const after = await get('profile', me.cookie);
const solo = progress(after.j, 'on-my-own-2');
const road = progress(after.j, 'first-mile-2');
check('a rejected finish does not count toward on-my-own-2', solo?.value === 2 && solo?.target === 5, JSON.stringify({ solo, verdict: third.verdict, rides: [first.id, second.id, third.id] }));
check('the rejected ride was still started (first-mile-2 reads starts)', road?.value === 3, JSON.stringify(road));
await open();
check('the lobby still shows 2 / 5 after the rejected ride', (await shown()) === '2 / 5', await shown());
check('On My Own stays on the profile as an earned badge', await page.ev(`document.querySelector('[data-id="on-my-own"]').classList.contains('got')`));
await page.shot('after-rejected');
const problems = page.filt().filter(p => !/favicon|status of 4\d\d/.test(p));
check('no page errors', problems.length === 0, problems.join(' | '));
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall achievement checks passed');
page.finish(fails.length ? 1 : 0);
