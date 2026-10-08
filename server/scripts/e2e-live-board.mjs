// "Who is online, what is on the road, what can be replayed" in REAL headless Chrome against a RUNNING server, fed by the ride simulator
// (scripts/sim-rides.mjs – fake drivers, visitors and watchers over the API). Run with bash .claude/skills/live-board-test/run.sh, or by hand:
//   TRUST_PROXY=1 HB_TIMEOUT_MS=15000 FREE_RIDE_SECONDS=20 SOL_USD=118 TREASURY_PUBKEY=<addr> PORT=3111 node dist/main.js   (+ npm run landing:build)
//   BASE=http://localhost:3111 node scripts/e2e-live-board.mjs
// TRUST_PROXY=1: the simulated visitors come from their own X-Forwarded-For addresses (the online counter caps 3 ids per address);
// HB_TIMEOUT_MS=15000: the abandoned ride is swept within ~20 s instead of 3 min.
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../client/tools/cdp.mjs';
import { simulate } from './sim-rides.mjs';
const BASE = process.env.BASE || 'http://localhost:3111', CP = +process.env.CHROME_PORT || 9395;
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const until = async (fn, ms, step = 400) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(step); } return false; };
const api = async (path, cookie) => (await fetch(`${BASE}/api/${path}`, { headers: cookie ? { cookie } : {} })).json();

// ── the world: 2 driving (one of them watched by 2), 1 that abandons after 12 s, 1 that completes its 20 s shift, 1 paused; 5 visitors ──
const sim = await simulate({ base: BASE, drive: 2, abandon: 1, complete: 1, pause: 1, visitors: 5, watchers: 2, abandonAfter: 12 });
const role = k => sim.drivers.filter(d => d.role === k).map(d => d.id);
const [gone] = role('abandon'), [finisher] = role('complete'), watched = role('drive')[0];
await until(async () => (await api('live')).rides.some(r => r.signal === 'paused'), 20_000);   // "paused" comes with the 10 s heartbeat (one right after the start is ignored)
const feed = await api('live');
check('the API: 5 rides on the road, each with an id, viewers and signal', feed.rides.length === 5 && feed.rides.every(r => r.id && typeof r.viewers === 'number' && r.signal), `${feed.rides.length} rides`);
check('the API: who is online = 5 visitors + 2 watchers + 5 drivers (5 signed in)', feed.online.browsing === 5 && feed.online.watching === 2 && feed.online.driving === 5 && feed.online.total === 12 && feed.online.players === 5, JSON.stringify(feed.online));
check('the API: the watched ride shows its 2 viewers, the paused one says paused', feed.rides.find(r => r.id === watched)?.viewers === 2 && feed.rides.some(r => r.signal === 'paused'));

// ── a signed-in player of our own (the lobby needs one), with one finished ride of its own for MINE ──
const kp = nacl.sign.keyPair(), me = bs58.encode(kp.publicKey);
const post = async (path, body, cookie) => fetch(`${BASE}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body) });
const ch = await (await post('auth/nonce', { wallet: me })).json();
const cookie = (await post('auth/verify', { wallet: me, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) })).headers.get('set-cookie').split(';')[0];
const mine = await (await post('rides', { tier: 'free' }, cookie)).json();
await post(`rides/${mine.id}/start`, {}, cookie); await sleep(1500);
await post(`rides/${mine.id}/end`, { outcome: 'failed', s: 5, t: 1, reason: 'You ran off the road.' }, cookie);

const B = await launch({ port: CP, shotsDir: 'fc-board-shots', evalProblems: true });
const [cn, cv] = cookie.split('=');
await B.send('Network.setCookie', { name: cn, value: cv, url: BASE, httpOnly: true });

// ── the landing ──
await B.send('Page.navigate', { url: `${BASE}/` });
const chip = () => B.ev(`document.getElementById('chip-live')?.textContent ?? ''`);
check('landing: the chip says how many are online and on the road (from the live feed)', await until(async () => /^\d+ ONLINE · 5 ON THE ROAD$/.test(await chip()), 20_000), await chip());
check('landing: this page itself is counted online', await until(async () => (await api('live')).online.browsing >= 6, 15_000), JSON.stringify((await api('live')).online));
check('landing: LIVE NOW lists the 5 rides as watch links, the watched one with 👁 2', await until(() => B.ev(`document.querySelectorAll('#board-live a.r[href*="watch="]').length === 5 && [...document.querySelectorAll('#board-live a.r')].some(a => a.href.includes(${JSON.stringify(watched)}) && a.textContent.includes('👁 2'))`), 15_000));
await B.shot('landing-boards');

// ── the lobby: LIVE (sort, viewers, join) ──
await B.send('Page.navigate', { url: `${BASE}/lobby.html#live` });
check('lobby: the header chip says online · on the road', await until(() => B.ev(`/^\\d+ online · 5 on the road$/.test(document.getElementById('chip-live')?.textContent ?? '')`), 15_000), await B.ev(`document.getElementById('chip-live')?.textContent`));
check('lobby LIVE: 5 rides, each with 👁 viewers and a WATCH (join) link; the online line under the title', await until(() => B.ev(`document.querySelectorAll('#rides .ride').length === 5 && document.querySelectorAll('#rides .ride a.watch').length === 5 && /online now/.test(document.getElementById('live-online').textContent)`), 15_000));
await B.ev(`(() => { const s = document.getElementById('live-sort'); s.value = 'watched'; s.dispatchEvent(new Event('change')); })()`);
check('lobby LIVE: sorting by "most watched" puts the watched ride first', await until(() => B.ev(`document.querySelector('#rides .ride:not([hidden]) a.watch')?.href.includes(${JSON.stringify(watched)})`), 8000));
check('lobby LIVE: a paused ride shows PAUSED', await B.ev(`[...document.querySelectorAll('#rides .ride .badge')].some(b => b.textContent === 'PAUSED')`));
await B.shot('lobby-live');
const onBoard = await B.ev(`[...document.querySelectorAll('#rides .ride a.watch')].map(a => new URL(a.href).searchParams.get('watch'))`);
await B.ev(`document.getElementById('live-random').click()`);
check('lobby LIVE: WATCH A RANDOM ONE joins one of the rides on the board, on its watch page', await until(() => B.ev(`location.pathname === '/play.html' && ${JSON.stringify(onBoard)}.includes(window.__game?.watch?.ride?.id) && !!document.getElementById('watch')`), 20_000), await B.ev('location.href'));

// ── an abandoned ride: swept, off the boards, in the history as "signal lost"; the completed one replays ──
check('the abandoned ride is ENDED by the stale-ride sweeper (failed · heartbeat lost)', await until(async () => (await api(`replays?limit=50`)).rows.some(r => r.id === gone && r.failCode === 'heartbeat_lost'), 60_000));
check('…and it left the live feed', !(await api('live')).rides.some(r => r.id === gone));
check('the completing driver finished its shift (COMPLETED)', await until(async () => (await api('replays?limit=50')).rows.some(r => r.id === finisher && r.status === 'completed' && r.replay), 60_000));

await B.send('Page.navigate', { url: `${BASE}/lobby.html#replays` });
const line = id => `document.querySelector('#replays .replay[data-id="${id}"]')`;
check('lobby REPLAYS: the abandoned ride – FAILED · signal lost', await until(() => B.ev(`/FAILED · signal lost/.test(${line(gone)}?.textContent ?? '')`), 15_000));
check('lobby REPLAYS: the completed ride – COMPLETED with ▶ REPLAY', await until(() => B.ev(`/COMPLETED/.test(${line(finisher)}?.textContent ?? '') && !!${line(finisher)}?.querySelector('a.watch')`), 8000));
await B.ev(`[...document.querySelectorAll('.filters .f')].find(b => b.textContent === 'MINE').click()`);
check('lobby REPLAYS: MINE shows only the signed-in player\'s ride (FAILED · off the road, no recording)', await until(() => B.ev(`document.querySelectorAll('#replays .replay').length === 1 && !!${line(mine.id)} && /off the road/.test(${line(mine.id)}.textContent) && /no recording/.test(${line(mine.id)}.textContent)`), 8000));
await B.ev(`[...document.querySelectorAll('.filters .f')].find(b => b.textContent === 'EVERYONE').click()`);
await B.ev(`[...document.querySelectorAll('.filters .f')].find(b => b.textContent === 'COMPLETED').click()`);
check('lobby REPLAYS: COMPLETED filters by outcome', await until(() => B.ev(`[...document.querySelectorAll('#replays .replay')].length >= 1 && [...document.querySelectorAll('#replays .replay')].every(r => /COMPLETED/.test(r.textContent))`), 8000));
await B.shot('lobby-replays');
await B.ev(`${line(finisher)}.querySelector('a.watch').click()`);
check('▶ REPLAY opens the finished ride as a replay with its recording', await until(() => B.ev(`!!window.__game?.watch?.ride && window.__game.watch.ride.live === false && window.__game.watch.rows.length > 50`), 20_000), `${await B.ev('window.__game?.watch?.rows?.length')} samples`);

// ── the landing's RECENT RIDES ──
await B.send('Page.navigate', { url: `${BASE}/` });
check('landing RECENT RIDES: the finished rides, the recorded one as a ▶ REPLAY link', await until(() => B.ev(`!!document.querySelector('#board-recent a.r[href*="watch=${finisher}"]') && /signal lost/.test(document.getElementById('board-recent').textContent)`), 20_000));
await B.shot('landing-recent');
await B.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await B.send('Page.navigate', { url: `${BASE}/lobby.html#replays` }); await sleep(2500); await B.shot('lobby-replays-phone');

await sim.stop();
const probs = B.filt().filter(p => !/401.*\/api\/me/.test(p));
check('no page errors', probs.length === 0, probs.join(' | '));
console.log(`screenshots: ${B.SHOTS}`);
B.finish(fails.length ? 1 : 0, 300);
