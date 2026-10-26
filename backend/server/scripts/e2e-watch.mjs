import { acceptLocalTestTerms } from './local-test-terms.mjs';
// A running ride is not a public stream (RPL-M-03). Training rides stay private after they end (RPL-M-02).
// The driver still plays. A second browser opening ?watch= must not receive the ride.
// Usage: BASE=http://localhost:3111 node scripts/e2e-watch.mjs   (or: bash .claude/skills/run-tests/e2e.sh watch)
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111', CP = +process.env.CHROME_PORT || 9341;
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const call = async (method, path, body, cookie) => { const r = await fetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body ? JSON.stringify(body) : undefined }); return { r, j: await r.json().catch(() => ({})) }; };
const signIn = async () => {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const { j: ch } = await call('POST', 'auth/nonce', { wallet });
  const { r } = await call('POST', 'auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) });
  const cookie = await acceptLocalTestTerms(BASE, r.headers.get('set-cookie')?.split(';')[0]);
  if (!cookie) throw new Error(`sign-in failed ${r.status}`);
  return { wallet, cookie: cookie.split(';')[0] };
};
const until = async (fn, ms, step = 300) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(step); } return false; };

const driver = await signIn();
const { j: ride } = await call('POST', 'rides', { tier: 'free' }, driver.cookie);
check('driver: free ride created', ride.status === 'created', ride.status);
const D = await launch({ port: CP, shotsDir: 'fc-watch-shots', evalProblems: true });
const [name, value] = driver.cookie.split('=');
await D.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
await D.send('Page.navigate', { url: `${BASE}/play.html?ride=${ride.id}` });
for (let i = 0; i < 100 && !(await D.ev('!!window.__game')); i++) await sleep(200);
await D.ev('document.getElementById("go").click()'); await sleep(800);
const mine = await call('GET', `rides/${ride.id}`, undefined, driver.cookie);
check('driver: ride running', mine.j.status === 'running', mine.j.status);
const hidden = await call('GET', `watch/${ride.id}`);
check('a running ride is not a public replay', hidden.r.status === 404 && hidden.j.code === 'replay_not_available', `${hidden.r.status} ${hidden.j.code}`);
const road = await call('GET', `watch/${ride.id}/road?from=0&to=6000`);
check('a running ride has no public road plan', road.r.status === 404 && road.j.code === 'replay_not_available', `${road.r.status} ${road.j.code}`);
// This is a visibility test. Completion/playback is exercised by replay-controls.
// Unload the driver before ending through the API, so its heartbeat cannot race the fixture cleanup.
await D.send('Page.navigate', { url: 'about:blank' });
await sleep(300);
const S = await launch({ port: CP + 1, shotsDir: 'fc-watch-shots', evalProblems: true });
await S.send('Page.navigate', { url: `${BASE}/play.html?watch=${ride.id}` });
check('spectator: the page does not open the running ride', await until(() => S.ev('!!window.__game && !__game.watch?.ride'), 20_000));
let ended = await call('GET', `rides/${ride.id}`, undefined, driver.cookie);
if (ended.j.status === 'running' || ended.j.status === 'created') ended = await call('POST', `rides/${ride.id}/end`, { outcome: 'failed', s: 1, t: 1, hull: 100, reason: 'e2e' }, driver.cookie);
check('driver: the ride ended', ended.j.status !== 'running' && ended.j.status !== 'created', ended.j.status || String(ended.r.status));
const after = await call('GET', `watch/${ride.id}`);
check('a finished training ride stays off public replays', after.r.status === 404 && after.j.code === 'replay_not_available', after.j.code);
const noise = p => !/road plan: server error 404|\/watch\/[^ ]+\/road\?|status of 404/.test(p);
check('no page errors (driver)', D.filt().filter(noise).length === 0, D.filt().filter(noise).join(' | '));
check('no page errors (spectator)', S.filt().filter(noise).length === 0, S.filt().filter(noise).join(' | '));
console.log(`screenshots: ${S.SHOTS}`);
D.finish(fails.length ? 1 : 0, 300); S.finish(fails.length ? 1 : 0, 300);
