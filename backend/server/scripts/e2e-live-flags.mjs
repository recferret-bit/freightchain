// LIVE_* flags no longer open a running ride. A running ride is 404 replay_not_available on watch, chat, and donations
// whether the flags are the paid set or off (RPL-M-03). Chat and tips belong on a finished public replay.
// Usage: MODE=paid|off BASE=http://localhost:3111 node scripts/e2e-live-flags.mjs
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111', MODE = process.env.MODE || 'paid', CP = +process.env.CHROME_PORT || 9391;
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} [${MODE}] ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
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
await call('POST', `rides/${ride.id}/start`, {}, driver.cookie);
const view = await call('GET', `watch/${ride.id}`);
check('a running ride is not watchable', view.r.status === 404 && view.j.code === 'replay_not_available', `${view.r.status} ${view.j.code}`);
const chat = await call('POST', `watch/${ride.id}/messages`, { text: 'hello' }, fan.cookie);
const gift = await call('POST', `watch/${ride.id}/donations`, { effect: 'tip' }, fan.cookie);
check('chat and donations on a running free ride are refused', (chat.r.status === 404 || (chat.r.status === 403 && chat.j.code === 'free_ride_no_stream')) && gift.r.status === 404, `${chat.r.status} ${chat.j.code} ${gift.r.status} ${gift.j.code}`);

const S = await launch({ port: CP, shotsDir: 'fc-flags-shots', evalProblems: true });
const [cn, cv] = fan.cookie.split('=');
await S.send('Network.setCookie', { name: cn, value: cv, url: BASE, httpOnly: true });
await S.send('Page.navigate', { url: `${BASE}/play.html?watch=${ride.id}` });
check('the watch page does not open the running ride', await until(() => S.ev('!!window.__game && !__game.watch?.ride'), 20_000));
await S.shot(`flags-${MODE}`);
const problems = S.filt().filter(p => !/status of 404|replay_not_available/.test(p));
check('no page errors', problems.length === 0, problems.join(' | ').slice(0, 300));
console.log(`screenshots: ${S.SHOTS}`);
S.finish(fails.length ? 1 : 0, 300);
