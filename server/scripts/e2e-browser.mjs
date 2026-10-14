// Full-stack check in REAL headless Chrome against a RUNNING server (no wallet extension: a tweetnacl keypair signs the challenge, the session cookie is
// handed to Chrome): sign in → create a free ride → play.html?ride=… takes the server's seed + shift length → START → heartbeats → pause → END SHIFT → server verdict.
// Usage: FREE_RIDE_SECONDS=3 SOL_USD=118 TREASURY_PUBKEY=<any address> PORT=3111 node dist/main.js  (other terminal; PostgreSQL up + migrated: npm run db:up && npm run prisma:deploy)   then   BASE=http://localhost:3111 node scripts/e2e-browser.mjs
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep, answerPrompts, driveHook } from '../../client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111', MIN = +(process.env.FREE_RIDE_SECONDS || 3);
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const post = async (path, body, cookie) => { const r = await fetch(`${BASE}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body) }); return { r, j: await r.json() }; };

const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
const { j: ch } = await post('auth/nonce', { wallet });
const { r: vr } = await post('auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) });
const cookie = vr.headers.get('set-cookie').split(';')[0]; check('sign-in (signature verified by the server)', vr.ok);
const { j: ride } = await post('rides', { tier: 'free' }, cookie); check('free ride created', ride.status === 'created', JSON.stringify(ride));

const { send, ev, shot, filt, SHOTS, finish } = await launch({ port: +process.env.CHROME_PORT || 9335, shotsDir: 'fc-online-shots', evalProblems: true });
const [name, value] = cookie.split('=');
await send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
await send('Page.navigate', { url: `${BASE}/play.html?ride=${ride.id}` });
for (let i = 0; i < 100 && !(await ev('!!window.__game')); i++) await sleep(200);
check('game booted', await ev('!!window.__game'));
check('shift length comes from the server (the free run: 0.25 × 28 m/s × seconds)', (await ev('__game.CFG.RIDE_MIN_SECONDS')) === MIN && Math.abs((await ev('__game.CFG.COMPLETE_DIST')) - 0.25 * 28 * MIN) < 1e-6, `${await ev('__game.CFG.RIDE_MIN_SECONDS')} s · ${await ev('__game.CFG.COMPLETE_DIST')} m`);
await ev('document.getElementById("go").click()'); await sleep(800);
check('ride started on the server', (await (await fetch(`${BASE}/api/rides/${ride.id}`, { headers: { cookie } })).json()).status === 'running');
check('road seed = the server seed', (await ev('__game.roads.seed')) === ride.seed, `${await ev('__game.roads.seed')} vs ${ride.seed}`);
await shot('online-drive');
check('the ride is being recorded', await ev('__game.telemetry.on === true && __game.telemetry.rideId === ' + JSON.stringify(ride.id)));
// headless can't really drive: grow the distance with the GAME clock at 20 m/s (under the governor, so neither the heartbeat check nor the recording's teleport check trips)
await ev(driveHook(20));
// …and press keys the way a person does (real CDP key events through the game's own listeners, jittered holds and gaps) – the verdict reads their timing
const press = async (code, key, hold) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); await sleep(hold); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key }); };
const KEYS = [['KeyW', 'w'], ['KeyA', 'a'], ['KeyD', 'd'], ['KeyW', 'w'], ['ArrowUp', 'ArrowUp']];
// wait on the GAME's clock (software-rendered headless Chrome runs at ~half real time), then end before the first 10 s heartbeat: the final /end alone must carry the time
const stopPrompts = answerPrompts({ ev, send });   // a dispatch prompt may arrive with a heartbeat on a slow machine – answer it like a person (unanswered ones flag the ride)
const t0 = Date.now();
for (let i = 0; !(await ev('__game.st.complete')) && Date.now() - t0 < 30000 + MIN * 3000; i++) {   /* headless runs the game clock at ~0.4× */ const [code, key] = KEYS[i % KEYS.length]; await press(code, key, 60 + Math.random() * 340); await sleep(80 + Math.random() * 420); }
const waited = (Date.now() - t0) / 1000; console.log(waited < 9 ? `ok   ended before the first 10 s heartbeat (${waited.toFixed(1)} s) – only /end carried the time` : `NOTE ${waited.toFixed(1)} s after START: a heartbeat had already fired (slow machine) – this run did not isolate the /end-only path (vitest does)`);
await ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true }))'); await sleep(500);
check('shift is complete in the client', await ev('__game.st.complete'), `t=${await ev('__game.st.t.toFixed(1)')} s`);
stopPrompts();
await ev('document.getElementById("endshift")?.click()'); await sleep(1500);
const verdict = await ev('document.getElementById("verdict")?.textContent');
check('server verdict = COMPLETED · VERIFIED', verdict === 'COMPLETED · VERIFIED', String(verdict));
await shot('online-done');
const now = await (await fetch(`${BASE}/api/rides/${ride.id}`, { headers: { cookie } })).json();
check('server state', now.status === 'completed', `${now.status}, ${now.driveSeconds} s, ${now.distance} m`);
// the WebCrypto hash chain the game built must be the one the server recomputes (a mismatch would be 'hash-mismatch' / 'chain-broken')
check('recording verified by the server (chain hashed alike in the browser and in Node)', now.verdict?.status === 'verified', JSON.stringify(now.verdict));
check('every batch uploaded, none refused', (await ev('__game.telemetry.queue.length')) === 0 && (await ev('__game.telemetry.seq')) >= 1 && (await ev('__game.telemetry.refused === null')) === true, `${await ev('__game.telemetry.seq')} batch(es), ${await ev('__game.telemetry.queue.length')} queued`);
const probs = filt(); check('no page errors', probs.length === 0, probs.join(' | '));
console.log(`screenshots: ${SHOTS}`); finish(fails.length ? 1 : 0);
