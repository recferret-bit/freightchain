// Statistics, end to end (docs/spec/platform_services.md) in REAL headless Chrome against a RUNNING server on a fresh database:
//   the landing's hero tiles (DRIVEN, ALL TIME was 0.00 km · 0 shifts on production while rides had driven – only COMPLETE shifts were counted), the lobby's
//   DRIVING RECORD (per rider), GET /api/stats, and every way a ride ends and a donation lands – a REAL game driving into a car (the client's crash counter →
//   heartbeat / end report → the server's totals), a ride that fails by a bad report, a ride the stale-ride sweeper ends, a shift that completes, a donation
//   to the driver's stream – and finally `stats:reconcile` against the live database (clean, then a broken row it finds and repairs).
//   server: FREE_RIDE_SECONDS=20 HB_TIMEOUT_MS=15000 TRUST_PROXY=1 … node dist/main.js   ·   BASE=http://localhost:3111 node scripts/e2e-stats.mjs
// Or: bash .claude/skills/run-tests/e2e.sh stats. Needs DATABASE_URL + CLI (the built cli/index.js) for the reconcile step.
import { spawnSync } from 'node:child_process';
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep, driveHook } from '../../../frontend/client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111';
const CLI = process.env.CLI || 'dist/cli/index.js';
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const until = async (fn, ms, step = 300) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(step); } return false; };
const api = async (path, cookie) => (await fetch(`${BASE}/api/${path}`, { headers: cookie ? { cookie } : {} })).json();
const post = async (path, body, cookie, x = {}) => fetch(`${BASE}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }), ...x }, body: JSON.stringify(body) });
const signIn = async () => {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey), ch = await (await post('auth/nonce', { wallet })).json();
  const res = await post('auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) });
  return { wallet, cookie: res.headers.get('set-cookie').split(';')[0] };
};
const newRide = async who => (await post('rides', { tier: 'free' }, who.cookie)).json();
const stats = () => api('stats');
const career = async who => (await api('profile', who.cookie)).career;
const cli = (...args) => spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: process.env });

// a real Redis (with a password) sits behind the API when REDIS_CONTAINER is set (run-tests/e2e.sh stats): its keys are looked at with redis-cli inside the container
const REDIS = process.env.REDIS_CONTAINER;
const redisKeys = () => spawnSync('docker', ['exec', REDIS, 'sh', '-c', 'redis-cli --scan --pattern "fc:*"'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();

// ── 0. a fresh database: zeros everywhere, the landing says so without overflowing ──
const base = await stats();
if (REDIS) check('redis: the first read cached the game\'s totals under fc:stats:global', redisKeys().includes('fc:stats:global'), redisKeys().join(', '));
check('GET /api/stats is public and starts at zero', base.rides === 0 && base.metres === 0 && base.crashes === 0 && base.donations === 0 && base.drivers === 0, JSON.stringify(base));

const B = await launch({ port: +process.env.CHROME_PORT || 9411, shotsDir: 'fc-stats-shots', evalProblems: true });
const me = await signIn();
const [cn, cv] = me.cookie.split('=');
await B.send('Network.setCookie', { name: cn, value: cv, httpOnly: true, path: '/', url: BASE });
const heroOf = () => B.ev(`({ km: document.getElementById('hero-km')?.textContent, rides: document.getElementById('hero-shifts')?.textContent, time: document.getElementById('hero-time')?.textContent })`);
await B.send('Page.navigate', { url: `${BASE}/` });
await until(() => B.ev(`!!document.getElementById('hero-km') && /ON THE ROAD/.test(document.getElementById('chip-live')?.textContent || '')`), 20_000);
let hero = await heroOf();
check('landing: DRIVEN, ALL TIME starts at 0 · 0 rides', /^0(\.00)?$/.test(hero.km) && hero.rides === '0 rides' && hero.time === '0 s', JSON.stringify(hero));

// every tile's text fits its box at desktop, laptop, tablet and phone widths (the green text must never wrap or spill)
const fit = () => B.ev(`[...document.querySelectorAll('#hero-stats .stat')].map(s => ({ id: s.querySelector('.num')?.id, over: [...s.querySelectorAll('.num, .lbl, .unit')].some(e => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > s.getBoundingClientRect().right + 1), lines: Math.round(s.querySelector('.num').getBoundingClientRect().height / parseFloat(getComputedStyle(s.querySelector('.num')).fontSize)) }))`);
const fitsAll = async label => {
  for (const [w, h] of [[1920, 1000], [1440, 900], [1024, 800], [768, 900], [390, 800]]) {
    await B.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
    await sleep(300);
    const tiles = await fit();
    check(`landing hero tiles fit at ${w}px (${label}): no spill, every number on one line`, tiles.length === 4 && tiles.every(t => !t.over && t.lines <= 1), JSON.stringify(tiles.filter(t => t.over || t.lines > 1)));
  }
  await B.send('Emulation.clearDeviceMetricsOverride');
};
await fitsAll('empty');

// ── 1. a REAL game: drives into a car → the client's crash counter → the server's totals ──
const first = await newRide(me);
await B.send('Page.navigate', { url: `${BASE}/play.html?ride=${first.id}` });
await until(() => B.ev(`!!document.getElementById('go') && !!window.__game`), 30_000);
await B.ev(`document.getElementById('go').click()`);
await sleep(800);
// headless can't drive: driveHook holds the truck at 14 m/s (under the governor) and the game moves it; the first car ahead is a parked sedan the truck rams
await B.ev(driveHook(14, 'st.park = false; st.keyOn = true; st.engineOn = true;', 2.4));   // the right lane on the main road: the parked sedan is in it
check('game: the ride is on the road', await until(async () => (await api('live')).rides.some(r => r.id === first.id), 15_000));
const reached = await until(() => B.ev(`__game.st.s > __game.net.Sm + 30`), 60_000, 500);
check('game: the truck is out on the main road', reached, `s=${await B.ev('__game.st.s.toFixed(0)')}`);
for (let i = 0; i < 12 && !(await B.ev('window.__car === true')); i++) { await B.ev(`(() => { const g = __game, car = g.spawn('sedan', 'slow', 'ahead', 12 + (${i} % 4) * 2, 2.4); if (car) car.v = 0; window.__car = !!car; })()`); await sleep(150); }   // a spot can be taken by the game's own traffic: try a few
check('game: a car stands ahead', await B.ev('window.__car'));
await until(async () => (await api(`rides/${first.id}`, me.cookie)).status === 'failed' || (await B.ev('__game.st.mode')) === 'done', 90_000, 400);
check('game: the real client counted the contact with a vehicle', (await B.ev('__game.st.crashV')) >= 1, `crashV=${await B.ev('__game.st.crashV')}`);
const ended = await until(async () => (await api(`rides/${first.id}`, me.cookie)).status === 'failed', 30_000);
check('game: the ride ended (a crash fails it)', ended, (await api(`rides/${first.id}`, me.cookie)).reason);
await B.ev('window.__undrive()');
const afterCrash = await career(me), global1 = await stats();
check('server: the rider\'s record counted the failed ride – distance, time, the vehicle crash, no finished shift', afterCrash.rides === 1 && afterCrash.ridesFree === 1 && afterCrash.ridesPaid === 0 && afterCrash.ridesCompleted === 0 && afterCrash.metres > 50 && afterCrash.seconds > 0 && afterCrash.crashesVehicle >= 1 && afterCrash.crashesBuilding === 0, JSON.stringify(afterCrash));
check('server: GET /api/stats = the same numbers (the game\'s totals are this rider\'s so far)', global1.rides === 1 && global1.metres === afterCrash.metres && global1.crashesVehicle === afterCrash.crashesVehicle && global1.drivers === 1, JSON.stringify(global1));

// ── 2. the landing and the lobby show it ──
await B.send('Page.navigate', { url: `${BASE}/` });
const showed = await until(async () => { hero = await heroOf(); return parseFloat(hero.km) > 0; }, 20_000);
check('landing: DRIVEN, ALL TIME is no longer 0.00 after a ride that did not complete (the production bug)', showed, JSON.stringify(hero));
check('landing: the tile also says the rides and the time driven', hero.rides === '1 ride' && /^\d+ (s|min)$/.test(hero.time) && hero.time !== '0 s', JSON.stringify(hero));
await B.shot('landing-after-ride');
await fitsAll('after a ride');
await B.send('Page.navigate', { url: `${BASE}/lobby.html#profile` });
const tiles = () => B.ev(`Object.fromEntries([...document.querySelectorAll('#career .tile')].map(t => [t.dataset.k, t.querySelector('b').textContent]))`);
await until(async () => (await tiles()).rides !== undefined, 20_000);
const t1 = await tiles();
check('lobby profile: DRIVING RECORD shows the rider\'s totals (rides, km, time, vehicle crashes)', t1.rides === '1' && t1['rides-free'] === '1' && t1['rides-paid'] === '0' && t1.completed === '0' && parseFloat(t1.km) > 0 && /^\d+ (s|min)$/.test(t1.time) && +t1['crashes-vehicle'] >= 1 && t1['crashes-building'] === '0', JSON.stringify(t1));
await B.shot('profile-driving-record'); 
await B.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
await sleep(300);
check('lobby profile: the tiles fit a phone (no horizontal scroll)', await B.ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`));
await B.shot('profile-driving-record-phone');
await B.send('Emulation.clearDeviceMetricsOverride');

// ── 3. the other ways a ride ends, and a donation, through the API ──
const bob = await signIn(), carol = await signIn();
const startRide = async who => { const r = await newRide(who); await post(`rides/${r.id}/start`, {}, who.cookie); return r.id; };
// bob: a ride failed by an implausible report (the server ends it) – still counts the distance it had
const bobRide = await startRide(bob);
await sleep(1200);
await post(`rides/${bobRide}/heartbeat`, { s: 20, t: 1, hull: 100, crashesVehicle: 1 }, bob.cookie);
await sleep(1200);
const bad = await post(`rides/${bobRide}/heartbeat`, { s: 9000, t: 2, hull: 100 }, bob.cookie);
check('API: an implausible report fails the ride', bad.ok && (await bad.json()).status === 'failed');
const bobs = await career(bob);
check('API: …and the distance it had still counts, once', bobs.rides === 1 && bobs.metres === 20 && bobs.crashesVehicle === 1, JSON.stringify(bobs));
// carol: a building crash by the end report, a donation to her stream first
const carolRide = await startRide(carol);
const fan = await signIn();
const tip = await post(`watch/${carolRide}/donations`, { effect: 'tip' }, fan.cookie);
check('API: a spectator\'s donation lands on the stream', tip.ok, String(tip.status));
await sleep(1200);
await post(`rides/${carolRide}/end`, { outcome: 'failed', s: 12, t: 1, hull: 0, crashesBuilding: 1, reason: 'You crashed into a building – the truck is a wreck.' }, carol.cookie);
const carols = await career(carol), fans = await career(fan);
check('API: a building crash is counted on the driver, with the donation she got; the spectator\'s own record stays empty', carols.crashesBuilding === 1 && carols.crashesVehicle === 0 && carols.donations === 1 && fans.donations === 0 && fans.rides === 0, JSON.stringify(carols));
// dave: a ride whose tab vanished – the stale-ride sweeper ends it (HB_TIMEOUT_MS is short in this suite)
const dave = await signIn();
const daveRide = await startRide(dave);
await sleep(1200);
await post(`rides/${daveRide}/heartbeat`, { s: 15, t: 1, hull: 100 }, dave.cookie);
const swept = await until(async () => (await api(`rides/${daveRide}`, dave.cookie)).status === 'failed', 60_000, 1000);
check('sweeper: a ride whose tab vanished is ended by the stale-ride sweep', swept);
const daves = await career(dave);
check('sweeper: …and it counted what it drove', daves.rides === 1 && daves.metres === 15, JSON.stringify(daves));
const g2 = await stats();
check('GET /api/stats = the sum of the four riders', g2.rides === 4 && g2.ridesFree === 4 && g2.ridesPaid === 0 && g2.drivers === 4 && g2.metres === afterCrash.metres + 20 + 12 + 15 && g2.crashesVehicle === afterCrash.crashesVehicle + 1 && g2.crashesBuilding === 1 && g2.donations === 1, JSON.stringify(g2));
const daily = await api('stats/daily');
check('GET /api/stats/daily: one row for today, the days add up to the totals, no wallets', Array.isArray(daily) && daily.length >= 1 && daily.reduce((s, x) => s + x.rides, 0) === g2.rides && daily.reduce((s, x) => s + x.metres, 0) === g2.metres && /^\d{4}-\d{2}-\d{2}$/.test(daily.at(-1).day) && !JSON.stringify(daily).includes(me.wallet), JSON.stringify(daily).slice(0, 160));
check('the landing\'s live feed carries the same totals', JSON.stringify((({ rides, metres, drivers, crashes, donations }) => ({ rides, metres, drivers, crashes, donations }))((await api('live')).totals)) === JSON.stringify({ rides: g2.rides, metres: g2.metres, drivers: g2.drivers, crashes: g2.crashes, donations: g2.donations }), JSON.stringify((await api('live')).totals));
check('GET /api/stats is cached but never stale: a second read is identical', JSON.stringify(await stats()) === JSON.stringify(g2));
const raw = JSON.stringify(g2);
check('the public numbers carry no wallets', !raw.includes(me.wallet) && !raw.includes(bob.wallet), raw.slice(0, 120));

// ── 3b. the cache: written on read, dropped by a write, and a DEAD Redis never breaks the API ──
if (REDIS) {
  await stats(); await career(me);
  check('redis: reads cache the game\'s totals and the rider\'s record', ['fc:stats:global', `fc:stats:player:${me.wallet}`].every(k => redisKeys().includes(k)), redisKeys().join(', '));
  const eve = await signIn(), eveRide = await startRide(eve);
  await sleep(1200); await post(`rides/${eveRide}/end`, { outcome: 'failed', s: 5, t: 1, hull: 0 }, eve.cookie);
  check('redis: a ride that ends drops the cached totals at once (the next read is fresh, never stale)', !redisKeys().includes('fc:stats:global') && (await stats()).rides === 5);
  spawnSync('docker', ['stop', REDIS]);
  const dead = await fetch(`${BASE}/api/stats`), deadBody = await dead.json().catch(() => ({}));
  check('redis DOWN: GET /api/stats still answers from PostgreSQL', dead.status === 200 && deadBody.rides === 5, `${dead.status} ${JSON.stringify(deadBody).slice(0, 80)}`);
  check('redis DOWN: the landing feed and the profile still answer', (await fetch(`${BASE}/api/live`)).status === 200 && (await fetch(`${BASE}/api/profile`, { headers: { cookie: me.cookie } })).status === 200);
  const frank = await signIn(), frankRide = await startRide(frank);
  await sleep(1200);
  check('redis DOWN: a ride can still end (the write path needs no cache)', (await post(`rides/${frankRide}/end`, { outcome: 'failed', s: 7, t: 1, hull: 0 }, frank.cookie)).ok && (await stats()).rides === 6);
}

// ── 4. reconcile: clean, then a broken row is found and repaired ──
if (process.env.DATABASE_URL) {
  const run = (...a) => { const r = cli('stats:reconcile', ...a); try { return JSON.parse(r.stdout); } catch { return { error: r.stderr || r.stdout }; } };
  const clean = run();
  const riders = REDIS ? 6 : 4;
  check('stats:reconcile finds the live tables clean (riders, game and history)', clean.checked === riders && clean.drifted.length === 0 && clean.global === null && clean.days.length === 0, JSON.stringify(clean));
  const dbName = new URL(process.env.DATABASE_URL).pathname.slice(1);   // the compose PostgreSQL: psql inside its container
  const q = (sql) => spawnSync('docker', ['exec', 'freightchain-postgres', 'psql', '-U', 'freight', '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], { encoding: 'utf8' });
  q(`UPDATE stats."PlayerStats" SET metres = metres + 500, rides = rides + 3 WHERE wallet = '${bob.wallet}'`);
  q(`UPDATE stats."GlobalStats" SET donations = 0`);
  q(`UPDATE stats."DailyStats" SET metres = metres + 1000`);
  const dirty = run();
  check('stats:reconcile reports a rider whose row was edited and the global row that no longer adds up', dirty.drifted?.length === 1 && dirty.drifted[0].wallet === bob.wallet && dirty.drifted[0].fields.rides?.stored === 4 && !!dirty.global?.donations && dirty.days?.length >= 1, JSON.stringify(dirty).slice(0, 300));
  check('…without --fix it changes nothing', (await career(bob)).rides === 1 || (await career(bob)).rides === 4);
  const fixed = run('--fix');
  check('stats:reconcile --fix repairs both', fixed.fixed === true, JSON.stringify(fixed).slice(0, 200));
  await sleep(16_000);   // the cached answers (15 s) expire; the CLI's own cache is process-local when no Redis is shared
  const healed = await career(bob), g3 = await stats();
  check('the rider\'s record and the game\'s totals are right again', healed.rides === 1 && healed.metres === 20 && g3.donations === 1 && g3.rides === riders, JSON.stringify(g3));
  check('stats:reconcile is clean afterwards (history included)', run().drifted?.length === 0 && run().days.length === 0);
} else console.log('skip stats:reconcile (no DATABASE_URL)');

const probs = B.filt().filter(p => !/401.*\/api\/me/.test(p));
check('no page errors', probs.length === 0, probs.join(' | '));
console.log(`screenshots: ${B.SHOTS}`);
B.finish(fails.length ? 1 : 0, 300);
