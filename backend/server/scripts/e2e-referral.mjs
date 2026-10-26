import { acceptLocalTestTerms } from './local-test-terms.mjs';
// Real browser MEDIUM activation and Convoy profile; seeded ledger states test rendering only.
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
  return { wallet, cookie: await acceptLocalTestTerms(BASE, res.cookie) };
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
    row = await prisma.convoyInvite.findUnique({ where: { referee: invitee.wallet } });
    return row?.activatedAt ? row : null;
  }, 20000) : null;
  check('activatedAt is set on the invite', !!qualified?.activatedAt, JSON.stringify(row));
  const after = await call('GET', 'me', { cookie: referrer.cookie });
  const refereeMe = await call('GET', 'me', { cookie: invitee.cookie });
  const gift = (after.j.freeRides ?? 0) - (before.j.freeRides ?? 0);
  check('referrer free balance is unchanged', gift === 0, `${before.j.freeRides} → ${after.j.freeRides}`);
  const dbReferrer = await prisma.player.findUnique({ where: { wallet: referrer.wallet } });
  check('DB referrer freeRides matches /api/me', dbReferrer?.freeRides === after.j.freeRides, String(dbReferrer?.freeRides));
  check('referee free balance is unchanged', (refereeMe.j.freeRides ?? 0) - (beforeReferee.j.freeRides ?? 0) === 0, `${beforeReferee.j.freeRides} → ${refereeMe.j.freeRides}`);

  await tab.send('Network.setCookie', { name, value: referrer.cookie.split('=')[1], url: BASE, httpOnly: true });
  await tab.send('Page.navigate', { url: `${BASE}/lobby.html?convoy=${Date.now()}#profile` });
  check('lobby invite row says active', await until(async () => /active/.test(await tab.ev('document.getElementById("ref-invites")?.textContent || ""')), 25000), await tab.ev('document.getElementById("ref-box")?.textContent || ""'));
  check('one usable promo grant exists', await prisma.promoRideGrant.count({ where: { wallet: invitee.wallet, code: 'SYSTEM-CONVOY-1H', rideId: null } }) === 1);
  check('campaign tasks load beside Convoy in the real profile', await until(() => tab.ev('!!document.getElementById("campaign-box")?.querySelector("button") && !document.getElementById("campaign-box").textContent.includes("Loading")')));
  check('profile explains milestones and caps', await tab.ev('document.getElementById("ref-box").textContent.includes("48-hour") && document.getElementById("ref-invites").textContent.includes("M1")'));
  await tab.ev('document.getElementById("ref-hidden").click()');
  check('privacy toggle persists', await until(async () => (await call('GET', 'referrals', { cookie: referrer.cookie })).j.hidden === true));
  check('hidden referrer omitted from public leaderboard', !(await call('GET', 'referrals/leaderboard', { cookie: invitee.cookie })).j.rows.some(r => r.wallet === referrer.wallet));
  await tab.ev('document.getElementById("ref-box").scrollIntoView()');
  await tab.shot('convoy-active-hidden');
  // Rendering fixtures only: the earned/settled milestone lifecycle is covered by shared HTTP and PG tests.
  const stamp = new Date();
  await prisma.convoyLedger.createMany({ data: [
    { id: `convoy:m1:${invitee.wallet}`, kind: 'm1', wallet: referrer.wallet, referrer: referrer.wallet, referee: invitee.wallet, amount: 100, unit: 'ten4', at: stamp, dayKey: 'fixture', weekKey: 'fixture', chainState: 'held' },
    { id: `convoy:m2:${invitee.wallet}`, kind: 'm2', wallet: referrer.wallet, referrer: referrer.wallet, referee: invitee.wallet, amount: 50, unit: 'ten4', at: stamp, dayKey: 'fixture', weekKey: 'fixture', chainState: 'capped', capReason: 'monthly_cap' },
  ] });
  await tab.send('Page.navigate', { url: `${BASE}/lobby.html?convoy=held#profile` });
  check('held and capped reward states render', await until(async () => await tab.ev('(() => { const t = document.getElementById("ref-rewards")?.textContent || ""; return t.includes("HELD") && t.includes("CAPPED") && t.includes("monthly_cap"); })()')));
  await prisma.convoyLedger.update({ where: { id: `convoy:m1:${invitee.wallet}` }, data: { chainState: 'paid', paidUnits: 12500000n, chainSignature: 'fixture-confirmed-signature' } });
  await tab.send('Page.navigate', { url: `${BASE}/lobby.html?convoy=paid#profile` });
  check('actual paid amount and transaction render', await until(async () => await tab.ev('(() => { const t = document.getElementById("ref-rewards")?.textContent || ""; return t.includes("12.5 TEN4 paid") && t.includes("fixture-confirmed-signature"); })()')));
  await tab.ev('document.getElementById("ref-rewards").scrollIntoView()');
  await tab.shot('convoy-rewards');
  await tab.send('Network.setCookie', { name, value: invitee.cookie.split('=')[1], url: BASE, httpOnly: true });
  await tab.send('Page.navigate', { url: `${BASE}/lobby.html?convoy=${Date.now()}#profile` });
  check('invitee sees its activation and promo', await until(async () => /1h promo granted/.test(await tab.ev('document.getElementById("ref-progress")?.textContent || ""'))));
  await tab.ev('document.getElementById("ref-progress")?.scrollIntoView()');
  await tab.shot('convoy-invitee');
  const newcomer = await signIn();
  await tab.send('Network.setCookie', { name, value: newcomer.cookie.split('=')[1], url: BASE, httpOnly: true });
  await tab.send('Page.navigate', { url: `${BASE}/lobby.html?convoy=${Date.now()}#profile` });
  check('unbound wallet sees manual invite form', await until(async () => await tab.ev('!!document.getElementById("ref-input")')));
  await tab.ev('document.getElementById("ref-input").value = "ZZZZZZZZ"; document.getElementById("ref-apply").click()');
  check('invalid invite is visible and does not bind', await until(async () => /unknown referral code/.test(await tab.ev('document.getElementById("ref-msg")?.textContent || ""'))));
  await tab.ev(`document.getElementById("ref-input").value = ${JSON.stringify(code)}; document.getElementById("ref-apply").click()`);
  check('manual valid invite shows pending steps', await until(async () => /pending/.test(await tab.ev('document.getElementById("ref-progress")?.textContent || ""'))));
  await tab.shot('convoy-pending');
  // Real profile → authenticated API → binary Token-2022 fixture RPC → PostgreSQL.
  const seeker = await signIn(), fixture = async mode => {
    const result = await fetch(`http://127.0.0.1:${process.env.SGT_FIXTURE_PORT}`, { method: 'POST', body: JSON.stringify({ method: 'fixture', params: [seeker.wallet, mode] }) });
    if (!result.ok) throw new Error('SGT fixture unavailable');
  };
  const [seekerCookie, seekerValue] = seeker.cookie.split('=');
  await tab.send('Network.setCookie', { name: seekerCookie, value: seekerValue, url: BASE, httpOnly: true });
  await tab.send('Page.navigate', { url: `${BASE}/lobby.html#profile` });
  check('Seeker verification control loads', await until(async () => await tab.ev('!!document.getElementById("sgt-verify")')));
  await fixture('empty'); await tab.ev('document.getElementById("sgt-verify").click()');
  check('absent SGT gives a visible refusal', await until(async () => /no Seeker Genesis Token/.test(await tab.ev('document.getElementById("sgt-msg")?.textContent || ""'))));
  await fixture('outage'); await tab.ev('document.getElementById("sgt-verify").click()');
  check('SGT outage remains distinct from absent ownership', await until(async () => /temporarily unavailable/.test(await tab.ev('document.getElementById("sgt-msg")?.textContent || ""'))));
  await fixture('held'); await tab.ev('document.getElementById("sgt-verify").click()');
  check('verified SGT shows one-time shortcut and trust 100', await until(async () => /Current trust: 100/.test(await tab.ev('document.getElementById("sgt-box")?.textContent || ""'))));
  check('SGT persisted once in PostgreSQL', await prisma.sgtTrustClaim.count({ where: { wallet: seeker.wallet } }) === 1);
  await tab.ev('document.getElementById("sgt-box").scrollIntoView()'); await tab.shot('sgt-verified');
  const errors = pageErrors(tab).filter(e => !(/409 \(Conflict\)/.test(e) && /\/api\/referrals\/bind$/.test(e)) && !/\/api\/me\/trust\/sgt$/.test(e));
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
