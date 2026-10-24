// Referral qualify in headless Chrome. As-built (referral-rules.ts qualifyDecision): the free-ride gift is the
// FIRST verified finish of free level 2 (MEDIUM, trip free-2c), not a paid ride. Defaults are
// referral_free_rides_referrer = 2 and referral_free_rides_referee = 3. There is no referrerRideGift column.
// The lobby does not render that balance (training is unlimited). It renders the invite as "qualified".
//   FREE_RIDE_SECONDS=6 BASE=http://127.0.0.1:3103 CHROME_PORT=9233 DATABASE_URL=… node scripts/e2e-referral.mjs
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PrismaClient } from '@prisma/client';
import { launch, sleep, answerPrompts, driveHook } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:3103';
const PORT = +(process.env.CHROME_PORT || 9233);
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
const pageErrors = (h) => h.filt().filter((p) => /^(EXCEPTION|console\.error|log\.error|EVAL)/.test(p) && !/favicon/.test(p));

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
  return { wallet, cookie: res.cookie };
}

const referrer = await signIn();
const invitee = await signIn();
const before = await call('GET', 'me', { cookie: referrer.cookie });
const beforeReferee = await call('GET', 'me', { cookie: invitee.cookie });
const code = (await call('GET', 'referrals', { cookie: referrer.cookie })).j.code;
const bound = await call('POST', 'referrals/bind', { body: { code }, cookie: invitee.cookie });
if (!code || bound.status !== 200) {
  console.error('bind failed', code, bound.status, JSON.stringify(bound.j));
  process.exit(1);
}
const ordered = await call('POST', 'rides', { body: { tier: 'free', level: 2, tutorial: false, assist: false }, cookie: invitee.cookie });
if (ordered.status !== 200 || ordered.j.trip !== 'free-2c' || ordered.j.level !== 2) {
  console.error('medium ride was not ordered', ordered.status, JSON.stringify(ordered.j));
  process.exit(1);
}
const ride = ordered.j;

const tab = await launch({ port: PORT, shotsDir: 'fc-referral-shots', evalProblems: true });
const prisma = new PrismaClient();
try {
  await tab.send('Network.enable');
  const [name, value] = invitee.cookie.split('=');
  await tab.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  await tab.send('Page.navigate', { url: `${BASE}/play.html?ride=${ride.id}` });
  check('MEDIUM ride booted', await until(async () => await tab.ev('!!window.__game?.online?.ride && __game.online.ride.trip === "free-2c"'), 45000));
  await tab.ev('document.getElementById("go")?.click()');
  await sleep(600);
  await tab.ev(driveHook(20, 'st.park = false; st.engineOn = true; st.gas = 0.6; st.brake = 0; st.clutch = 0; if (!st.gear) st.gear = 4;'));
  const stopKeys = answerPrompts(tab);
  // Gas stays down so the pinned speed is not a coast. Brief taps would flag physics-coasting-mismatch.
  await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
  const t0 = Date.now();
  let done = false;
  for (let i = 0; Date.now() - t0 < 180000; i++) {
    done = await tab.ev('!!window.__game?.st?.complete');
    if (done) break;
    const codeKey = i % 2 ? 'KeyA' : 'KeyD';
    const key = codeKey === 'KeyA' ? 'a' : 'd';
    await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', code: codeKey, key });
    await sleep(70 + Math.random() * 180);
    await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', code: codeKey, key });
    await sleep(200 + Math.random() * 400);
  }
  await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
  stopKeys();
  check('the client crossed the MEDIUM finish line', done === true);
  let verdict = null;
  const judged = await until(async () => {
    verdict = (await call('GET', `rides/${ride.id}`, { cookie: invitee.cookie })).j.verdict;
    return verdict && verdict.status && verdict.status !== 'pending' ? verdict : null;
  }, 40000);
  check('the server verdict is verified', judged?.status === 'verified', JSON.stringify(verdict));
  let row = null;
  const qualified = judged?.status === 'verified' ? await until(async () => {
    row = await prisma.referral.findUnique({ where: { referee: invitee.wallet } });
    return row?.qualifiedAt ? row : null;
  }, 20000) : null;
  check('qualifiedAt is set on the invite', !!qualified?.qualifiedAt, JSON.stringify(row));
  const after = await call('GET', 'me', { cookie: referrer.cookie });
  const refereeMe = await call('GET', 'me', { cookie: invitee.cookie });
  const gift = (after.j.freeRides ?? 0) - (before.j.freeRides ?? 0);
  check('referrer freeRides grew by 2 (referral_free_rides_referrer)', gift === 2, `${before.j.freeRides} → ${after.j.freeRides}`);
  const dbReferrer = await prisma.player.findUnique({ where: { wallet: referrer.wallet } });
  check('DB referrer freeRides matches /api/me', dbReferrer?.freeRides === after.j.freeRides, String(dbReferrer?.freeRides));
  check('referee freeRides grew by 3 (referral_free_rides_referee)', (refereeMe.j.freeRides ?? 0) - (beforeReferee.j.freeRides ?? 0) === 3, `${beforeReferee.j.freeRides} → ${refereeMe.j.freeRides}`);

  await tab.send('Network.setCookie', { name, value: referrer.cookie.split('=')[1], url: BASE, httpOnly: true });
  await tab.send('Page.navigate', { url: `${BASE}/lobby.html#profile` });
  check('lobby invite row says qualified', await until(async () => /qualified/.test(await tab.ev('document.getElementById("ref-invites")?.textContent || ""')), 25000), await tab.ev('document.getElementById("ref-box")?.textContent || ""'));
  const errors = pageErrors(tab);
  const roadRequests = await tab.ev(`performance.getEntriesByType('resource').filter(r => /\\/api\\/watch\\/[^/]+\\/road(?:\\?|$)/.test(r.name)).length`);
  check('a driver never requests the spectator road endpoint', roadRequests === 0, String(roadRequests));
  check('no page or console errors', errors.length === 0, errors.join(' | '));
  await tab.shot('referral-done');
} finally {
  await prisma.$disconnect().catch(() => {});
  await tab.close();
}
if (fails.length) { console.error(`FAILED ${fails.length}: ${fails.join(', ')}`); process.exit(1); }
console.log('e2e-referral passed');
process.exit(0);
