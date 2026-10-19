// The LIVE_* feature flags in REAL headless Chrome against a RUNNING server started with them (bash .claude/skills/run-tests/e2e.sh flags runs both modes):
//   MODE=paid – LIVE_FREE_DONATIONS=off LIVE_EFFECTS=free (production's defaults): the watch panel offers PAID donations; a click builds an order and asks the
//               wallet (a fake Phantom here) to sign a transfer of exactly the price TO THE DRIVER with the order's memo; the free route is refused.
//               The confirm step can't finish without devnet SOL – the HTTP scenarios on FakeChain prove it (server/test/scenarios/live.scenarios.ts).
//   MODE=off  – LIVE_CHAT=off LIVE_DONATIONS=off: no chat box, no donation buttons, the API refuses both, watching still works.
// Usage: LIVE_FREE_DONATIONS=off LIVE_EFFECTS=free FREE_RIDE_SECONDS=300 SOL_USD=118 TREASURY_PUBKEY=<addr> PORT=3111 node dist/main.js   then   MODE=paid BASE=http://localhost:3111 node scripts/e2e-live-flags.mjs
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111', MODE = process.env.MODE || 'paid', CP = +process.env.CHROME_PORT || 9391;
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} [${MODE}] ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const call = async (method, path, body, cookie) => { const r = await fetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body ? JSON.stringify(body) : undefined }); return { r, j: await r.json().catch(() => ({})) }; };
const signIn = async () => {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const { j: ch } = await call('POST', 'auth/nonce', { wallet });
  const { r } = await call('POST', 'auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) });
  return { wallet, cookie: r.headers.get('set-cookie').split(';')[0] };
};
const until = async (fn, ms, step = 300) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(step); } return false; };

// a ride on the air (API only: started rides stay live for the heartbeat timeout – 150 s – which is all this needs)
const driver = await signIn(), fan = await signIn();
const { j: ride } = await call('POST', 'rides', { tier: 'free' }, driver.cookie);
await call('POST', `rides/${ride.id}/start`, {}, driver.cookie);
const view = (await call('GET', `watch/${ride.id}`)).j;
check('the watch poll carries the ride\'s features', JSON.stringify(view.features) === JSON.stringify(MODE === 'paid' ? { chat: true, donations: true, payment: 'chain', effects: true } : { chat: false, donations: false, payment: 'mock', effects: false }), JSON.stringify(view.features));

const S = await launch({ port: CP, shotsDir: 'fc-flags-shots', evalProblems: true });
// a fake Phantom: the signed-in wallet, and a signAndSendTransaction that only RECORDS what it was asked to sign (nothing reaches any chain)
await S.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__asked = []; window.phantom = { solana: { isPhantom: true, publicKey: { toString: () => ${JSON.stringify(fan.wallet)}, toBase58: () => ${JSON.stringify(fan.wallet)} },
  connect: async () => ({}), signMessage: async () => { throw new Error('not used'); }, signAndSendTransaction: async (tx) => { window.__asked.push(tx); return { signature: '5'.repeat(88) }; } } };` });
const [cn, cv] = fan.cookie.split('=');
await S.send('Network.setCookie', { name: cn, value: cv, url: BASE, httpOnly: true });
await S.send('Page.navigate', { url: `${BASE}/play.html?watch=${ride.id}` });
for (let i = 0; i < 100 && !(await S.ev('!!window.__game')); i++) await sleep(200);
await until(() => S.ev('!!document.getElementById("w-me")?.children.length && !!document.getElementById("w-msg")'), 10_000);
await S.shot(`flags-${MODE}`);

if (MODE === 'paid') {
  check('the panel says donations are paid in devnet SOL to the driver', await S.ev(`/devnet SOL, sent from your wallet to the driver/.test(document.getElementById('w-me').textContent)`));
  check('chat box + all six buttons (a free ride: effects allowed)', await S.ev('!!document.getElementById("w-text") && document.querySelectorAll(".w-fx button").length === 6'));
  const free = await call('POST', `watch/${ride.id}/donations`, { effect: 'tip' }, fan.cookie);
  check('the free (mock) route is refused: 403 payment_required', free.r.status === 403 && free.j.code === 'payment_required', `${free.r.status} ${free.j.code}`);
  await S.ev('[...document.querySelectorAll(".w-fx button")].find(b => b.textContent.includes("NIGHT")).click()');
  check('NIGHT asks the wallet to sign a transaction', await until(() => S.ev('window.__asked.length === 1'), 20_000), `asked ${await S.ev('window.__asked.length')}`);
  const tx = await S.ev(`(() => { const t = window.__asked[0], ins = t?.instructions ?? [];
    const transfer = ins.find(i => i.programId.toBase58() === '11111111111111111111111111111111'), memo = ins.find(i => i.programId.toBase58().startsWith('Memo'));
    const lamports = transfer ? Number(new DataView(transfer.data.buffer, transfer.data.byteOffset).getBigUint64(4, true)) : null;
    return { to: transfer?.keys[1].pubkey.toBase58(), from: transfer?.keys[0].pubkey.toBase58(), lamports, memo: memo ? new TextDecoder().decode(memo.data) : null }; })()`);
  check('…a transfer FROM the spectator TO the driver of exactly the NIGHT price, with the order memo', tx.from === fan.wallet && tx.to === driver.wallet && tx.lamports === 20_000_000 && /^fc-donation:[0-9a-f-]{36}$/.test(tx.memo ?? ''), JSON.stringify(tx));
  check('…and the panel waits for the network to confirm it', await until(() => S.ev(`/waiting for the network|not confirmed it yet|network/i.test(document.getElementById('w-msg').textContent)`), 10_000), await S.ev(`document.getElementById('w-msg').textContent`));
  check('nothing is in the feed before the transfer is seen on chain', ((await call('GET', `watch/${ride.id}`)).j.events ?? []).length === 0);
} else {
  check('no chat box – "Chat is off on this ride."', await S.ev(`!document.getElementById('w-text') && /Chat is off on this ride/.test(document.getElementById('w-me').textContent)`));
  check('no donation buttons – "Donations are off."', await S.ev(`document.querySelectorAll('.w-fx button').length === 0 && /Donations are off/.test(document.getElementById('w-me').textContent)`));
  const msg = await call('POST', `watch/${ride.id}/messages`, { text: 'hi' }, fan.cookie), gift = await call('POST', `watch/${ride.id}/donations`, { effect: 'tip' }, fan.cookie);
  check('the API refuses both: 403 live_feature_off', msg.r.status === 403 && gift.r.status === 403 && msg.j.code === 'live_feature_off', `${msg.r.status} ${gift.r.status}`);
  check('watching still works (REPLAY / LIVE panel, the ride\'s state)', await S.ev(`/LIVE|REPLAY/.test(document.getElementById('w-state').textContent)`));
}
const ps = S.filt().filter(p => !/401.*\/api\/me|403.*\/api\/watch|5\d\d.*confirm|confirm.*5\d\d/.test(p));   // by design: refused posts; a confirm the dev RPC can't resolve
check('no page errors', ps.length === 0, ps.join(' | '));
console.log(`screenshots: ${S.SHOTS}`);
S.finish(fails.length ? 1 : 0, 300);
