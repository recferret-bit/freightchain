import { acceptLocalTestTerms } from './local-test-terms.mjs';
// "Who is online, what is on the road, what can be replayed" in REAL headless Chrome against a RUNNING server, fed by the ride simulator
// (scripts/sim-rides.mjs – fake drivers, visitors and watchers over the API). Run with bash .claude/skills/live-board-test/run.sh, or by hand:
//   TRUST_PROXY=1 HB_TIMEOUT_MS=15000 FREE_RIDE_SECONDS=20 SOL_USD=118 TREASURY_PUBKEY=<addr> PORT=3111 node dist/main.js   (+ npm run landing:build)
//   BASE=http://localhost:3111 node scripts/e2e-live-board.mjs
// TRUST_PROXY=1: the simulated visitors come from their own X-Forwarded-For addresses (the online counter caps 3 ids per address);
// HB_TIMEOUT_MS=15000: the abandoned ride is swept within ~20 s instead of 3 min.
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';
import { simulate } from './sim-rides.mjs';
const BASE = process.env.BASE || 'http://localhost:3111', CP = +process.env.CHROME_PORT || 9395;
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const until = async (fn, ms, step = 400) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(step); } return false; };
const api = async (path, cookie) => (await fetch(`${BASE}/api/${path}`, { headers: cookie ? { cookie } : {} })).json();

// ── the world: 2 driving (one of them watched by 2), 1 that abandons after 12 s, 1 that completes its 20 s shift, 1 paused; 5 visitors ──
const sim = await simulate({ base: BASE, drive: 2, abandon: 1, complete: 1, pause: 1, visitors: 5, watchers: 2, abandonAfter: 12 });
const role = k => sim.drivers.filter(d => d.role === k).map(d => d.id);
const [gone] = role('abandon'), [finisher] = role('complete');
const goneWho = sim.drivers.find(d => d.id === gone), finWho = sim.drivers.find(d => d.id === finisher);
await until(async () => (await api('live')).online.browsing >= 5, 20_000);   // visitors register on the public feed; a free ride is not a public card (RPL-M-11)
const feed = await api('live');
check('the API: a ride still on the road is not a public card', feed.rides.length === 0, `${feed.rides.length} rides`);
check('the API: free rides are not the public driving count; the 5 visitors are', feed.online.browsing === 5 && feed.online.watching === 0 && feed.online.driving === 0 && feed.online.total === 5, JSON.stringify(feed.online));

// ── a signed-in player of our own (the lobby needs one), with one finished ride of its own for MINE ──
const kp = nacl.sign.keyPair(), me = bs58.encode(kp.publicKey);
const post = async (path, body, cookie) => fetch(`${BASE}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body) });
const ch = await (await post('auth/nonce', { wallet: me })).json();
const cookie = (await post('auth/verify', { wallet: me, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) })).headers.get('set-cookie').split(';')[0];
await acceptLocalTestTerms(BASE, cookie);
const mine = await (await post('rides', { tier: 'free' }, cookie)).json();
await post(`rides/${mine.id}/start`, {}, cookie); await sleep(1500);
await post(`rides/${mine.id}/end`, { outcome: 'failed', s: 5, t: 1, reason: 'You ran off the road.' }, cookie);

const B = await launch({ port: CP, shotsDir: 'fc-board-shots', evalProblems: true });
/* the landing's boards sit far below the fold and reveal on scroll: jump there (no smooth scroll), reveal, then a normal shot */
const shotOf = async (sel, name) => {
  await B.ev(`(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelectorAll('.rv').forEach(n => n.classList.add('in')); const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); window.scrollTo(0, r.top + scrollY - 90); })()`);
  await sleep(1200);
  await B.shot(name);
};
const [cn, cv] = cookie.split('=');
await B.send('Network.setCookie', { name: cn, value: cv, url: BASE, httpOnly: true });

// ── the landing ──
await B.send('Page.navigate', { url: `${BASE}/` });
const chip = () => B.ev(`document.getElementById('chip-live')?.textContent ?? ''`);
check('landing: the chip counts visitors and does not put a free ride on the road', await until(async () => /^\d+ ONLINE · 0 ON THE ROAD$/.test(await chip()), 20_000), await chip());
check('landing: this page itself is counted online', await until(async () => (await api('live')).online.browsing >= 6, 15_000), JSON.stringify((await api('live')).online));
const privateRideIds = [...sim.drivers.map(d => d.id), mine.id];
const publicReplayIds = ((await api('replays?limit=50')).rows ?? []).map(r => r.id);
check('landing: ticker links only public replays and never these private rides', await until(() => B.ev(`(() => {
  const links = [...document.querySelectorAll('.ticker a[href*="watch="]')].map(a => new URL(a.href).searchParams.get('watch'));
  return links.every(id => !${JSON.stringify(privateRideIds)}.includes(id) && ${JSON.stringify(publicReplayIds)}.includes(id)) && !document.getElementById('board-live');
})()`), 15_000));
await shotOf('.boards', 'landing-boards');

// ── the lobby: LIVE (sort, viewers, join) ──
await B.send('Page.navigate', { url: `${BASE}/lobby.html#live` });
check('lobby: the header chip says online · 0 on the road', await until(() => B.ev(`/^\\d+ online · 0 on the road$/.test(document.getElementById('chip-live')?.textContent ?? '')`), 15_000), await B.ev(`document.getElementById('chip-live')?.textContent`));
check('lobby LIVE: no public ride cards while the free rides are on the road', await until(() => B.ev(`/No trucks on the road/.test(document.getElementById('rides')?.textContent ?? '') && document.querySelectorAll('#rides .ride').length === 0`), 15_000));
await B.shot('lobby-live');
await B.ev(`document.getElementById('live-random')?.click()`);
check('lobby LIVE: WATCH A RANDOM ONE stays on the lobby when the board is empty', await B.ev(`location.pathname === '/lobby.html'`), await B.ev('location.href'));

// ── an abandoned free ride is swept; a completed one finishes. Neither is a public replay. ──
check('the abandoned ride is ENDED by the stale-ride sweeper (failed · heartbeat lost)', await until(async () => { const j = await api(`rides/${gone}`, goneWho.cookie); return j.status === 'failed' && j.reason === 'heartbeat lost'; }, 60_000));
check('…and it is not a public live card', !(await api('live')).rides.some(r => r.id === gone));
check('the completing driver finished its shift (COMPLETED)', await until(async () => (await api(`rides/${finisher}`, finWho.cookie)).status === 'completed', 60_000));
check('a finished training ride is not on the public replay board', !(await api('replays?limit=50')).rows?.some(r => r.id === finisher || r.id === gone));

await B.send('Page.navigate', { url: `${BASE}/lobby.html#replays` });
check('lobby REPLAYS: the training rides are not listed', await until(() => B.ev(`!document.querySelector('#replays .replay[data-id="${finisher}"]') && !document.querySelector('#replays .replay[data-id="${gone}"]')`), 15_000));
await B.ev(`[...document.querySelectorAll('.filters button')].find(b => b.textContent === 'MINE')?.click()`);
check('lobby REPLAYS: MINE does not publish the training ride either', await until(() => B.ev(`/You have no finished rides yet/.test(document.getElementById('replays')?.textContent ?? '')`), 8000), await B.ev(`document.getElementById('replays')?.textContent?.slice(0, 80)`));
await B.shot('lobby-replays');

// ── the landing's RECENT RIDES ──
await B.send('Page.navigate', { url: `${BASE}/` });
check('landing RECENT RIDES: a finished training ride is not linked', await until(() => B.ev(`!document.querySelector('#board-recent a[href*="watch=${finisher}"]')`), 20_000));
await shotOf('.boards', 'landing-recent');
await B.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await B.send('Page.navigate', { url: `${BASE}/lobby.html#replays` }); await sleep(2500); await B.shot('lobby-replays-phone');

// (closing a page – the landing / lobby / watch page leave, the game tab's /end beacon, Back – is scripts/e2e-close.mjs: e2e.sh close close-split)
await sim.stop();
const probs = B.filt().filter(p => !/401.*\/api\/me/.test(p) && !/road plan|\/road\?from=|replay_not_available/.test(p));
check('no page errors', probs.length === 0, probs.join(' | '));
console.log(`screenshots: ${B.SHOTS}`);
B.finish(fails.length ? 1 : 0, 300);
