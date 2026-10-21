// Lane 4: a finished 1h recording in headless Chrome. Clock, camera, and seek are driven on that ride.
// Removed controls C9, C26, C27, and C32 stay absent. Chrome missing is logged; a started page that lacks a control fails.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const ROOT = new URL('../../..', import.meta.url);
const PORT = process.env.PORT || '3104';
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const panel = readFileSync(new URL('../../../frontend/client/js/ui/watch-panel.js', import.meta.url), 'utf8');
for (const id of ['w-live', 'w-honk-day', 'w-honk-night', 'w-honk-snow', 'w-honk-clear', 'w-pledges', 'pledgeForm']) check(`source has no ${id}`, !panel.includes(id));
const actions = readFileSync(new URL('../../../frontend/client/js/ui/watch-actions.js', import.meta.url), 'utf8');
check('C30 #w-qr is built for a chain tip', actions.includes("id: 'w-qr'"));

const ownServer = !process.env.BASE;
let server = null;
const treasury = new URL('../../../backend/server/data/treasury.json', import.meta.url);
let treasuryBak = null;

async function up() {
  if (!ownServer) return;
  const { renameSync } = await import('node:fs');
  try { renameSync(treasury, `${treasury.pathname}.lane4bak`); treasuryBak = `${treasury.pathname}.lane4bak`; } catch { /* no treasury file */ }
  const env = {
    ...process.env,
    PORT,
    DATABASE_URL: 'postgresql://freight:freight_dev_password@127.0.0.1:15434/freightchain_e2e',
    REDIS_URL: 'redis://:freight_dev_redis@127.0.0.1:16381',
    JWT_SECRET: 'freightchain-e2e-jwt-secret-32chars-min',
    ADMIN_JWT_SECRET: 'freightchain-e2e-admin-jwt-secret-32ch',
    NODE_ENV: 'development',
    APP_DOMAIN: `127.0.0.1:${PORT}`,
    APP_ORIGIN: BASE,
    PAYMENT_MODE: 'transfer',
    SOLANA_RPC: 'http://127.0.0.1:9',
    POSTHOG_ENABLED: '0',
    THROTTLE_LIMIT: '10000',
    THROTTLE_AUTH_LIMIT: '10000',
    THROTTLE_AUTH_RPS: '1000',
    WATCH_INTERVAL_MS: '0',
    CRANK_INTERVAL_MS: '0',
    PAYOUT_INTERVAL_MS: '0',
  };
  server = spawn(process.execPath, ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health/live`)).ok) return; } catch { /* booting */ }
    await sleep(500);
  }
  throw new Error('API did not start');
}

async function down() {
  if (server) server.kill();
  if (treasuryBak) { const { renameSync } = await import('node:fs'); try { renameSync(treasuryBak, treasury); } catch { /* already restored */ } }
}

const call = async (method, path, body, cookie, headers = {}) => {
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...headers, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? cookie, json: await r.json().catch(() => ({})) };
};
const signIn = async () => {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const nonce = await call('POST', 'auth/nonce', { wallet });
  const ver = await call('POST', 'auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.json.message), kp.secretKey)) });
  return { wallet, cookie: ver.cookie };
};

function samples(t1) {
  const rows = [];
  for (let i = 0; i <= t1 * 10; i++) {
    const t = i / 10;
    rows.push([t, t * 10, 2.4, 0, 10, 900, 1, 100, 0.2, 0, 0, 0, 0, 0, 0, 0]);
  }
  return rows;
}

try {
  await up();
  const driver = await signIn();
  const fan = await signIn();
  await call('PUT', 'profile/agreements', { age18: true, loss: true }, driver.cookie);
  let made = await call('POST', 'rides', { tier: '1h' }, driver.cookie, { 'x-fc-country': 'RS' });
  if (made.status !== 200) {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ datasources: { db: { url: 'postgresql://freight:freight_dev_password@127.0.0.1:15434/freightchain_e2e' } } });
    const now = new Date();
    const play = new Date(now.getTime() + 4 * 3_600_000);
    await db.pool.upsert({
      where: { id: 910461 },
      update: { status: 'active', playDeadline: play, prepDeadline: new Date(now.getTime() + 2 * 3_600_000), payoutAt: new Date(now.getTime() + 86_400_000) },
      create: {
        id: 910461, address: 'lane4replay910461', tier: '1h', label: '1h', priceLamports: 1n, minTickets: 1, maxTickets: 0, maxPerWallet: 5,
        prepDeadline: new Date(now.getTime() + 2 * 3_600_000), playDeadline: play, payoutAt: new Date(now.getTime() + 86_400_000),
        prizeBps: 8500, seedBps: 500, feeBps: 1000, feeTreasury: 'FeeTreasury11111111111111111111111111111111', seedTreasury: 'SeedTreasury1111111111111111111111111111111',
        status: 'active', rideSeed: 7, createdAt: new Date(now.getTime() - 60_000), ticketsSold: 1,
      },
    });
    await db.rideTicket.upsert({ where: { wallet_poolId: { wallet: driver.wallet, poolId: 910461 } }, update: { balance: 1 }, create: { wallet: driver.wallet, poolId: 910461, balance: 1, bought: 1 } });
    await db.$disconnect();
    made = await call('POST', 'rides', { tier: '1h' }, driver.cookie, { 'x-fc-country': 'RS' });
  }
  check('1h ride created', made.status === 200 && made.json.id, JSON.stringify(made.json).slice(0, 180));
  const id = made.json.id;
  const started = await call('POST', `rides/${id}/start`, {}, driver.cookie);
  check('ride started', started.status === 200, JSON.stringify(started.json).slice(0, 120));
  const batch = await call('POST', `rides/${id}/batches`, { seq: 0, prevHash: id, t0: 0, t1: 2, samples: samples(2), inputs: [[10, 'KeyW', 1]], hash: null }, driver.cookie);
  check('recording batch stored', batch.status === 200 && batch.json.stored === true, JSON.stringify(batch.json).slice(0, 160));
  const ended = await call('POST', `rides/${id}/end`, { outcome: 'failed', s: 20, t: 2, hull: 100 }, driver.cookie);
  check('ride ended', ended.status === 200, JSON.stringify(ended.json).slice(0, 160));
  const watch = await call('GET', `watch/${id}`);
  check('public replay of the recording', watch.status === 200 && watch.json.recording?.lastSeq === 0, JSON.stringify(watch.json).slice(0, 160));

  let chrome;
  const chromeArgs = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'];
  try { chrome = await launch({ port: Number(process.env.CHROME_PORT || 9374), shotsDir: 'fc-lane4-replay', evalProblems: true, args: chromeArgs }); }
  catch (error) {
    console.log(`Chrome did not start: ${error.message}`);
    process.exit(fails.length ? 1 : 0);
  }
  const [cn, cv] = fan.cookie.split('=');
  await chrome.send('Network.setCookie', { name: cn, value: cv, url: BASE, httpOnly: true });
  await chrome.send('Page.navigate', { url: `${BASE}/play.html?watch=${id}` });
  const until = async (expr, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await chrome.ev(expr)) return true; await sleep(200); }
    return false;
  };
  check('watch panel mounted on the recorded ride', await until(`!!document.getElementById('w-play') && __game.watch.ride && __game.watch.ride.id === ${JSON.stringify(id)}`));
  const present = [
    ['C1', '#w-play'], ['C2', '.spd[data-x="1"]'], ['C3', '.spd[data-x="0.5"]'], ['C4', '#w-seek'], ['C5', '#w-marks'], ['C6', '#w-marks'],
    ['C7', '#w-prev'], ['C7', '#w-next'], ['C8', '#w-back'], ['C10', '#w-sound'], ['C11', '#w-map'], ['C13', '.w-fold'], ['C14', '#watch-yard'], ['C15', '#w-cam'],
    ['C16', '#w-full'], ['C17', '#w-hud'], ['C18', '#w-share'], ['C20', '#w-time'], ['C21', '#w-road'], ['C22', '#w-feed'], ['C23', '#w-me'],
    ['C24', '#w-text'], ['C25', '#w-honk'], ['C28', '#w-tips'], ['C29', '#w-note-in'], ['C31', '#w-msg'], ['C33', '#w-note'], ['C35', '.cb-mute'], ['C36', '#w-react'],
  ];
  await until(`!!document.getElementById('w-honk')`, 8000);
  for (const [name, sel] of present) check(`${name} ${sel}`, !!(await chrome.ev(`!!document.querySelector(${JSON.stringify(sel)})`)));
  for (const [name, sel] of [['C9', '#w-live'], ['C26', '#w-honk-day'], ['C27', 'button[data-effect]'], ['C32', '#w-pledges']]) {
    check(`${name} absent`, !(await chrome.ev(`!!document.querySelector(${JSON.stringify(sel)})`)));
  }
  await until(`(__game.watch.rows || []).length > 5`, 15000);
  // The replay starts already playing. Park on second 0 and pause, then press play, so the click is what moves the clock.
  await chrome.ev(`(() => { const s = document.getElementById('w-seek'); s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  if (await chrome.ev('!!__game.watch.playing')) await chrome.ev(`document.getElementById('w-play').click()`);
  const clock0 = Number(await chrome.ev('__game.watch.wt'));
  await chrome.ev(`document.getElementById('w-play').click()`);
  let clockMoved = await until(`typeof __game.watch.wt === 'number' && __game.watch.wt > ${clock0} + 0.05`, 4000);
  if (!clockMoved) {
    console.log(`wall frames stalled at wt ${await chrome.ev('__game.watch.wt')} playing ${await chrome.ev('__game.watch.playing')}; granting virtual time to the shipped frame loop`);
    await chrome.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 1500, maxVirtualTimeTaskStarvationCount: 100 });
    clockMoved = await until(`typeof __game.watch.wt === 'number' && __game.watch.wt > ${clock0} + 0.05`, 8000);
  }
  const clock1 = await chrome.ev('__game.watch.wt');
  check('clock advances while playing', clockMoved && typeof clock1 === 'number' && clock1 > clock0, `${clock0} -> ${clock1}`);
  const cam0 = await chrome.ev('__game.st.watchCam');
  await chrome.ev(`document.getElementById('w-cam').click()`);
  const cam1 = await chrome.ev('__game.st.watchCam');
  check('camera changes', cam0 && cam1 && cam0 !== cam1, `${cam0} -> ${cam1}`);
  await chrome.ev(`(() => { const s = document.getElementById('w-seek'); s.value = 2; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const sought = await until(`Math.abs(__game.watch.wt - 2) < 0.6`, 8000);
  check('seek lands on the recorded second', sought, `wt ${await chrome.ev('__game.watch.wt')}`);
  const shade0 = await chrome.ev('__game.CFG.FORM_SHADE');
  await chrome.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F8', bubbles: true, cancelable: true }))`);
  const shade1 = await chrome.ev('__game.CFG.FORM_SHADE');
  check('C12 F8 toggles form shade', shade0 !== shade1, `${shade0} -> ${shade1}`);
  const play0 = await chrome.ev('!!__game.watch.playing');
  await chrome.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }))`);
  const play1 = await chrome.ev('!!__game.watch.playing');
  check('C19 Space toggles play', play0 !== play1, `${play0} -> ${play1}`);
  check('C30 #w-qr stays out until a chain tip', !(await chrome.ev(`!!document.getElementById('w-qr')`)));
  await chrome.send('Page.navigate', { url: `${BASE}/play.html?watch=00000000-0000-4000-8000-00000000c034` });
  check('C34 nothing to watch links to replays', await until(`(document.querySelector('#watch.w-error b')?.textContent || '').includes('NOTHING') && !!document.querySelector('#watch.w-error a[href*="#replays"]')`, 30000));
  await chrome.close();
} catch (error) {
  console.log(`FAIL ${error.stack || error.message}`);
  fails.push('crash');
} finally {
  await down();
}
process.exit(fails.length ? 1 : 0);
