import { acceptLocalTestTerms } from './local-test-terms.mjs';
// Seeds a running server with one running free ride + two finished ones so the landing boards / ticker have rows (demo, screenshots). BASE=http://localhost:3111 node scripts/seed-landing.mjs
import nacl from 'tweetnacl'; import bs58 from 'bs58';
const BASE = process.env.BASE || 'http://localhost:3111';
const post = async (p, b, c) => { const r = await fetch(`${BASE}/api/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(c && { cookie: c }) }, body: JSON.stringify(b) }); return { r, j: await r.json() }; };
async function wallet() { const kp = nacl.sign.keyPair(), address = bs58.encode(kp.publicKey), { j } = await post('auth/nonce', { wallet: address }); const { r } = await post('auth/verify', { wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) }); return { address, cookie: await acceptLocalTestTerms(BASE, r.headers.get('set-cookie').split(';')[0]) }; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const [route, s, finish] of [['siberia', 70, true], ['brenner', 40, false], ['route66', 20, null]]) {
  const w = await wallet(), { j } = await post('rides', { tier: 'free' }, w.cookie);
  await post(`rides/${j.id}/start`, {}, w.cookie); await sleep(200);
  await post(`rides/${j.id}/heartbeat`, { s: 20, t: 1, hull: 97, route, night: false }, w.cookie);
  if (finish === null) continue;                                              // stays running → LIVE NOW
  await sleep(3200); await post(`rides/${j.id}/heartbeat`, { s, t: 3.2, hull: 90, route }, w.cookie);
  await post(`rides/${j.id}/end`, finish ? { outcome: 'shift', s: 90, t: 3.5, hull: 90 } : { outcome: 'failed', s, t: 3.3, reason: 'head-on' }, w.cookie);
}
console.log(JSON.stringify(await (await fetch(`${BASE}/api/live`)).json()).slice(0, 400));
