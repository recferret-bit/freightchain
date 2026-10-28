import { acceptLocalTestTerms } from './local-test-terms.mjs';
// Guest EASY in real headless Chrome, plus the refusals CreateRideHandler actually throws.
// As-built (not the issue's names): a guest cookie is fc_session with Player.guest, the finished row is status
// 'completed' (there is no 'finished'), a paid tier is 409 guest_easy_only, a level on a paid tier is 409
// level_free_only, and tutorial/assist on a paid tier is 409 conflict. There is no guest_free_only or training_tier_free_only.
// Server: FREE_RIDE_SECONDS=6 PRIZE_DEV_DEFAULT_COUNTRY=KP PORT=3103 node dist/main.js
//   BASE=http://127.0.0.1:3103 CHROME_PORT=9233 DATABASE_URL=… node scripts/e2e-guest-training.mjs
import { PrismaClient } from '@prisma/client';
import { launch, sleep, driveHook } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:3103';
const PORT = +(process.env.CHROME_PORT || 9233);
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const until = async (fn, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
// easy-entry probes GET /api/me before the guest cookie exists. That 401 is the bootstrap, not a page throw.
const expected = (p) => /status of 401/.test(p) && /\/api\/me\b/.test(p);
const pageErrors = (h) => h.filt().filter((p) => /^(EXCEPTION|console\.error|log\.error|EVAL)/.test(p) && !expected(p));

const post = async (path, body, cookie) => {
  const r = await fetch(`${BASE}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};

const tab = await launch({ port: PORT, shotsDir: 'fc-guest-shots', evalProblems: true });
const prisma = new PrismaClient();
try {
  await tab.send('Network.enable');
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  await tab.send('Page.navigate', { url: `${BASE}/play.html` });
  const booted = await until(async () => /[?&]ride=/.test(await tab.ev('location.search')) && await tab.ev('!!window.__game?.online?.ride'), 45000);
  check('bare play.html opens a guest EASY ride (no wallet)', booted, String(await tab.ev('location.href')));
  const ride = booted ? await tab.ev('({ id: __game.online.ride.id, tier: __game.online.ride.tier, trip: __game.online.ride.trip, level: __game.online.ride.level })') : null;
  check('the ride is free-1c level 1', ride?.tier === 'free' && ride?.trip === 'free-1c' && ride?.level === 1, JSON.stringify(ride));
  const cookies = (await tab.send('Network.getCookies', { urls: [BASE] })).cookies ?? [];
  const session = cookies.find((c) => c.name === 'fc_session');
  check('session cookie is fc_session, not fc_guest', !!session && !cookies.some((c) => c.name === 'fc_guest'), cookies.map((c) => c.name).join(','));
  await tab.ev('document.getElementById("go")?.click()');
  await sleep(500);
  await tab.ev('if (window.__game?.endTutorial) __game.endTutorial(); if (window.__game?.guide) __game.guide.hold = false;');
  await tab.ev(driveHook(20, 'st.park = false; st.engineOn = true;'));
  const t0 = Date.now();
  let finished = false;
  while (Date.now() - t0 < 90000) {
    finished = await tab.ev('!!window.__game?.st?.complete');
    if (finished) break;
    await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
    await sleep(120);
    await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
    await sleep(180);
  }
  check('the finish line ends the guest ride in the client', finished === true, await tab.ev('JSON.stringify({ mode: __game?.st?.mode, s: __game?.st?.s, dist: __game?.CFG?.COMPLETE_DIST })'));
  const row = ride ? await until(async () => {
    const found = await prisma.ride.findUnique({ where: { id: ride.id }, include: { player: true } });
    return found?.status === 'completed' ? found : null;
  }, 25000) : null;
  check('DB status is completed (as-built; not finished) and the player is a guest', row?.status === 'completed' && row?.player?.guest === true, JSON.stringify({ status: row?.status, guest: row?.player?.guest }));
  const cookie = session ? `fc_session=${session.value}` : '';
  await acceptLocalTestTerms(BASE, cookie); // consent precedes the guest-tier refusals; the refusal codes are what this suite checks
  const paid = await post('rides', { tier: '1h' }, cookie);
  check('guest paid tier is 409 guest_easy_only (not guest_free_only)', paid.status === 409 && paid.j.code === 'guest_easy_only', `${paid.status} ${paid.j.code}`);
  const level = await post('rides', { tier: '1h', level: 1 }, cookie);
  check('a level on a paid tier is 409 level_free_only (not training_tier_free_only)', level.status === 409 && level.j.code === 'level_free_only', `${level.status} ${level.j.code} ${level.j.detail || ''}`);
  const tutorial = await post('rides', { tier: '1h', tutorial: true }, cookie);
  check('tutorial on a paid tier is 409 conflict', tutorial.status === 409 && tutorial.j.code === 'conflict' && /tutorial and assist are for free rides only/.test(tutorial.j.detail || ''), `${tutorial.status} ${tutorial.j.code} ${tutorial.j.detail || ''}`);
  const medium = await post('rides', { tier: 'free', level: 2 }, cookie);
  check('guest MEDIUM is 409 guest_easy_only', medium.status === 409 && medium.j.code === 'guest_easy_only', `${medium.status} ${medium.j.code}`);
  const errors = pageErrors(tab);
  const roadRequests = await tab.ev(`performance.getEntriesByType('resource').filter(r => /\\/api\\/watch\\/[^/]+\\/road(?:\\?|$)/.test(r.name)).length`);
  check('a driver never requests the spectator road endpoint', roadRequests === 0, String(roadRequests));
  check('no page or console errors', errors.length === 0, errors.join(' | '));
  await tab.shot('guest-done');
} finally {
  await prisma.$disconnect().catch(() => {});
  await tab.close();
}
if (fails.length) { console.error(`FAILED ${fails.length}: ${fails.join(', ')}`); process.exit(1); }
console.log('e2e-guest-training passed');
process.exit(0);
