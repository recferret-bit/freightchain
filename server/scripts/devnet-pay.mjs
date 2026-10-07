// REAL devnet run of the Day-1 loop: fund a fresh wallet from the faucet, sign in, order a 1 h ride, pay it on chain, let the server verify it, ride it (demo-scaled), check pool + leaderboard.
// Server (other terminal):  DB_PATH=<dir>/fc.sqlite  (run `node scripts/treasury-init.mjs <dir>/treasury.json` once)  DEMO_WALLETS='*' DEMO_SCALE=600  PORT=3112  node dist/main.js
//   (DEMO_SCALE=600 → the 1 h shift is 6 s / 84 m).  Then:  BASE=http://localhost:3112 node scripts/devnet-pay.mjs
// The public devnet faucet is rate-limited: if the airdrop fails this prints the address – fund it at https://faucet.solana.com and re-run with WALLET_SECRET=<that base58 secret>.
import { Connection, Keypair, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'; import nacl from 'tweetnacl'; import bs58 from 'bs58';
const BASE = process.env.BASE || 'http://localhost:3112', RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com', sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
let cookie = '';
const api = async (path, body) => { const r = await fetch(`${BASE}/api/${path}`, { method: body ? 'POST' : 'GET', headers: { ...(body && { 'content-type': 'application/json' }), ...(cookie && { cookie }) }, body: body && JSON.stringify(body) }); const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0]; return { status: r.status, j: await r.json().catch(() => ({})) }; };

const kp = process.env.WALLET_SECRET ? Keypair.fromSecretKey(bs58.decode(process.env.WALLET_SECRET)) : Keypair.generate(), me = kp.publicKey.toBase58(), conn = new Connection(RPC, 'confirmed');
console.log(`wallet ${me}${process.env.WALLET_SECRET ? '' : `  (secret ${bs58.encode(kp.secretKey)})`}`);
let bal = await conn.getBalance(kp.publicKey);
for (let i = 0; bal < 0.1 * LAMPORTS_PER_SOL && i < 2; i++) {
  try { const s = await conn.requestAirdrop(kp.publicKey, 0.5 * LAMPORTS_PER_SOL); await conn.confirmTransaction(s, 'confirmed'); } catch (e) { console.log(`airdrop ${i + 1} failed: ${String(e.message).slice(0, 120)}`); await sleep(3000); }
  bal = await conn.getBalance(kp.publicKey);
}
if (bal < 0.1 * LAMPORTS_PER_SOL) { console.log(`BLOCKED: no devnet SOL (balance ${bal / LAMPORTS_PER_SOL}). Fund ${me} at https://faucet.solana.com, then re-run with WALLET_SECRET=…`); process.exit(2); }
console.log(`balance ${bal / LAMPORTS_PER_SOL} SOL`);

const tiers = (await api('tiers')).j; check('quote + treasury', tiers.solUsd > 1 && !!tiers.treasury, `SOL/USD ${tiers.solUsd}, 1h = ${tiers.tiers.find(t => t.id === '1h').lamports} lamports`);
const poolBefore = (await api('pool')).j;
const ch = (await api('auth/nonce', { wallet: me })).j;
check('sign-in', (await api('auth/verify', { wallet: me, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) })).status === 200);
const ride = (await api('rides', { tier: '1h' })).j; check('ordered a 1 h ride', ride.status === 'awaiting_payment', `${ride.lamports} lamports ($${ride.priceUsd}), ×${ride.timeScale} → ${ride.minSeconds} s`);
check('cannot start unpaid', (await api(`rides/${ride.id}/start`, {})).status === 409);
const p = (await api(`rides/${ride.id}/payment`)).j, tx = Transaction.from(Buffer.from(p.transaction, 'base64')); tx.partialSign(kp);
const sig = await conn.sendRawTransaction(tx.serialize()); console.log(`sent ${sig}  https://explorer.solana.com/tx/${sig}?cluster=devnet`);
let paid; for (let i = 0; i < 40; i++) { const r = await api(`rides/${ride.id}/confirm`, { signature: sig }); if (r.status !== 202) { paid = r; break; } await sleep(1500); }
check('server verified the payment on devnet', paid?.status === 200 && paid.j.status === 'paid', JSON.stringify(paid?.j).slice(0, 160));
const poolAfter = (await api('pool')).j;
check('pool went up', poolAfter.split.entries - poolBefore.split.entries === ride.lamports, `+${poolAfter.split.entries - poolBefore.split.entries} lamports → grand ${poolAfter.split.grand} (≈ $${poolAfter.usd.grand})`);
const treasuryBal = await conn.getBalance(new (await import('@solana/web3.js')).PublicKey(tiers.treasury)); check('treasury received it', treasuryBal >= ride.lamports, `${treasuryBal} lamports`);

check('start', (await api(`rides/${ride.id}/start`, {})).status === 200);
const t0 = Date.now(); let s = 0;
while ((Date.now() - t0) / 1000 < ride.minSeconds + 1) { await sleep(1500); s = Math.min(ride.completeDist + 20, s + 20); const el = (Date.now() - t0) / 1000; await api(`rides/${ride.id}/heartbeat`, { s, t: el, hull: 100 }); }
const end = (await api(`rides/${ride.id}/end`, { outcome: 'shift', s, t: (Date.now() - t0) / 1000, hull: 100 })).j; check('ride completed (server verdict)', end.status === 'completed', `${end.driveSeconds} s, ${end.distance} m`);
const board = (await api('leaderboard')).j; check('on the leaderboard', board.rows.some(r => r.wallet === me), JSON.stringify(board.rows[0]));
process.exit(fails.length ? 1 : 0);
