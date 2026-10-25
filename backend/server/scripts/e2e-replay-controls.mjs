// Lane 4: a finished 1h recording in headless Chrome. Clock, camera, and seek are driven on that ride.
// Runs only through the isolated local e2e runner. A missing Chrome or control fails.
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE;
const database = process.env.DATABASE_URL;
if (!BASE || !database || !['localhost', '127.0.0.1'].includes(new URL(BASE).hostname) || !['localhost', '127.0.0.1'].includes(new URL(database).hostname) || !/^\/freightchain_e2e_\d+$/.test(new URL(database).pathname)) throw new Error('use e2e.sh replay-controls with its isolated local database');
let chrome;
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const panel = readFileSync(new URL('../../../frontend/client/js/ui/watch-panel.js', import.meta.url), 'utf8');
for (const id of ['w-live', 'w-honk-day', 'w-honk-night', 'w-honk-snow', 'w-honk-clear', 'w-pledges', 'pledgeForm']) check(`source has no ${id}`, !panel.includes(id));
const actions = readFileSync(new URL('../../../frontend/client/js/ui/watch-actions.js', import.meta.url), 'utf8');
check('C30 #w-qr is built for a chain tip', actions.includes("id: 'w-qr'"));

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
  const driver = await signIn(), fan = await signIn();
  const id = randomUUID();
  const db = new PrismaClient({ datasources: { db: { url: database } } });
  const now = new Date(), startedAt = new Date(now.getTime() - 120000);
  // Historical paid recording fixture. This checks playback, not ride verification or a chain purchase.
  const rows = samples(60);
  const body = { seq: 0, prevHash: id, t0: 0, t1: 60, samples: rows, inputs: [[10, 'KeyW', 1]] };
  for (const row of rows) row[14] = 12345;
  const json = JSON.stringify(body), hash = createHash('sha256').update(json).digest('hex');
  try {
    await db.ride.create({ data: {
      id, wallet: driver.wallet, tier: '1h', seed: 7, minSeconds: 3600, completeDist: 60000,
      status: 'failed', createdAt: startedAt, startedAt, endedAt: now, paidAt: startedAt,
      lastS: 600, lastT: 60, driveSeconds: 60, hull: 100, route: 'siberia', trip: '1h', startHour: 12,
      batches: { create: { seq: 0, prevHash: id, hash, serverHash: hash, hashOk: true, t0: 0, t1: 60,
        samples: rows.length, inputs: 1, bytes: Buffer.byteLength(json), payload: gzipSync(json), receivedAt: now } },
    } });
  } finally { await db.$disconnect(); }
  const watch = await call('GET', `watch/${id}`);
  check('public replay of the recording', watch.status === 200 && watch.json.recording?.lastSeq === 0, JSON.stringify(watch.json).slice(0, 160));

  check('public replay removes input bits and raw input events', watch.json.batches?.[0]?.samples?.every(row => row[14] === 0) && !('inputs' in (watch.json.batches?.[0] || {})));

  const chromeArgs = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'];
  try { chrome = await launch({ port: Number(process.env.CHROME_PORT || 9374), shotsDir: 'fc-lane4-replay', evalProblems: true, args: chromeArgs }); }
  catch (error) {
    console.log(`Chrome did not start: ${error.message}`);
    throw error;
  }
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
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
  const clockMoved = await until(`typeof __game.watch.wt === 'number' && __game.watch.wt > ${clock0} + 0.05`, 15000);
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
  await chrome.ev(`if (__game.watch.playing) document.getElementById('w-play').click()`);
  await chrome.ev(`document.getElementById('w-text').value = 'Road looks good'; document.querySelector('.w-say button').click()`);
  check('replay chat submits from the browser', await until(`document.getElementById('w-feed')?.textContent.includes('Road looks good')`));
  const feed = await call('GET', `watch/${id}`);
  check('chat persists with replay time', feed.json.events?.some(e => e.text === 'Road looks good' && Number.isFinite(e.replayT)));
  // A failed refresh must preserve the loaded recording, including an HTTP 200 with a malformed body.
  await chrome.ev(`(() => {
    const original = window.fetch;
    window.__replayFetch = original;
    window.fetch = (url, options) => String(url).includes('/api/watch/${id}?') ? Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) : original(url, options);
    const s = document.getElementById('w-seek'); s.value = 3; s.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  check('malformed refresh preserves the loaded recording', await until(`__game.watch.error === 'invalid replay response' && __game.watch.rec.lastSeq === 0 && __game.watch.rows.length > 5`));
  await chrome.ev(`(() => {
    window.fetch = window.__replayFetch; delete window.__replayFetch;
    const s = document.getElementById('w-seek'); s.value = 2; s.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  check('replay polling recovers after a failed refresh', await until(`__game.watch.error === '' && __game.watch.rec.lastSeq === 0`));
  await chrome.shot('replay-desktop');
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  check('phone replay has no document overflow', await chrome.ev('document.documentElement.scrollWidth <= innerWidth + 1'));
  const mobileCam = await chrome.ev('__game.st.watchCam');
  await chrome.ev(`document.getElementById('w-cam').click()`);
  check('phone camera responds', (await chrome.ev('__game.st.watchCam')) !== mobileCam);
  await chrome.shot('replay-phone');
  check('positive replay has no browser errors', chrome.filt().length === 0, chrome.filt().join(' | ').slice(0, 500));
  await chrome.send('Page.navigate', { url: `${BASE}/play.html?watch=00000000-0000-4000-8000-00000000c034` });
  check('C34 nothing to watch links to replays', await until(`(document.querySelector('#watch.w-error b')?.textContent || '').includes('NOTHING') && !!document.querySelector('#watch.w-error a[href*="#replays"]')`, 30000));
  await chrome.close(); chrome = null;
} catch (error) {
  console.log(`FAIL ${error.stack || error.message}`);
  fails.push('crash');
} finally {
  if (chrome) await chrome.close();
}
process.exit(fails.length ? 1 : 0);
