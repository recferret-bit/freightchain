// A finished training ride is not a public replay (RPL-M-02). Night and sinkhole donations are not accepted on a ride.
// The driver plays a free shift. The spectator page must not receive it. A missing id is the same 404.
// Usage: BASE=http://localhost:3111 node scripts/e2e-replay.mjs
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep, driveHook } from '../../../frontend/client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111', CP = +process.env.CHROME_PORT || 9361;
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const call = async (method, path, body, cookie) => { const r = await fetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body ? JSON.stringify(body) : undefined }); return { r, j: await r.json().catch(() => ({})) }; };
const signIn = async () => {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const { j: ch } = await call('POST', 'auth/nonce', { wallet });
  const { r } = await call('POST', 'auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) });
  const cookie = r.headers.get('set-cookie');
  if (!cookie) throw new Error(`sign-in failed ${r.status}`);
  return { wallet, cookie: cookie.split(';')[0] };
};
const until = async (fn, ms, step = 300) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(step); } return false; };

const driver = await signIn(), fan = await signIn();
const { j: ride } = await call('POST', 'rides', { tier: 'free' }, driver.cookie);
check('driver: free ride created', ride.status === 'created', ride.status);
const night = await call('POST', `watch/${ride.id}/donations`, { effect: 'night' }, fan.cookie);
check('NIGHT is not a donation on this ride', night.r.status === 400 || night.r.status === 404, `${night.r.status} ${night.j.code}`);
const D = await launch({ port: CP, shotsDir: 'fc-replay-shots', evalProblems: true });
const [cn, cv] = driver.cookie.split('=');
await D.send('Network.setCookie', { name: cn, value: cv, url: BASE, httpOnly: true });
await D.send('Page.navigate', { url: `${BASE}/play.html?ride=${ride.id}` });
for (let i = 0; i < 100 && !(await D.ev('!!window.__game')); i++) await sleep(200);
await D.ev('document.getElementById("go").click()'); await sleep(800);
await D.ev(driveHook(20));
const done = await until(() => D.ev('__game.st.complete'), 90_000);
if (!done) await call('POST', `rides/${ride.id}/end`, { outcome: 'failed', s: 1, t: 1, hull: 100, reason: 'e2e' }, driver.cookie);
else { await D.ev('document.getElementById("endshift")?.click()'); await sleep(1500); }
const ended = await call('GET', `rides/${ride.id}`, undefined, driver.cookie);
check('driver: the ride is no longer running', ended.j.status !== 'running' && ended.j.status !== 'created', ended.j.status);
const watch = await call('GET', `watch/${ride.id}`);
check('a training ride is not a public replay', watch.r.status === 404 && watch.j.code === 'replay_not_available', watch.j.code);
const missing = await call('GET', 'watch/00000000-0000-4000-8000-000000000000');
check('an unknown ride is not a replay', missing.r.status === 404, String(missing.r.status));
const S = await launch({ port: CP + 1, shotsDir: 'fc-replay-shots', evalProblems: true });
await S.send('Page.navigate', { url: `${BASE}/play.html?watch=${ride.id}` });
check('spectator: the page does not play the training ride', await until(() => S.ev('!!window.__game && !__game.watch?.ride'), 20_000));
const noise = p => !/road plan: server error 404|\/watch\/[^ ]+\/road\?|status of 404/.test(p);
check('no page errors (driver)', D.filt().filter(noise).length === 0, D.filt().filter(noise).join(' | ').slice(0, 300));
check('no page errors (spectator)', S.filt().filter(noise).length === 0, S.filt().filter(noise).join(' | ').slice(0, 300));
console.log(`screenshots: ${S.SHOTS}`);
D.finish(fails.length ? 1 : 0, 300); S.finish(fails.length ? 1 : 0, 300);
