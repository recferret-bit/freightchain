// Solana Pay donation: the browser wallet signs the server's transfer and the watch page confirms it.
// No devnet. SOLANA_RPC must be a local validator (this lane uses 127.0.0.1:8899). LIVE_FREE_DONATIONS=off
// so the donation is a real transfer. As-built the order row becomes status 'paid', not 'confirmed'.
// The UI goes from the pay QR (#w-qr) to "Tip sent (paid)."
//   RPC=http://127.0.0.1:8899 BASE=http://127.0.0.1:3103 CHROME_PORT=9233 DATABASE_URL=… node scripts/e2e-solana-pay.mjs
import { randomUUID } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair, PublicKey, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:3103';
const RPC = process.env.RPC || process.env.SOLANA_RPC || 'http://127.0.0.1:8899';
const PORT = +(process.env.CHROME_PORT || 9233);
const database = process.env.DATABASE_URL;
if (!database || !['localhost', '127.0.0.1'].includes(new URL(BASE).hostname) || !['localhost', '127.0.0.1'].includes(new URL(RPC).hostname) || !['localhost', '127.0.0.1'].includes(new URL(database).hostname) || !/^\/freightchain_e2e_\d+$/.test(new URL(database).pathname)) throw new Error('use e2e.sh replay-tips with its isolated local validator and database');
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const until = async (fn, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
const pageErrors = (h) => h.filt().filter((p) => /^(EXCEPTION|console\.error|log\.error|EVAL)/.test(p) && !/favicon/.test(p));

function walletOf(kp) {
  const naclKp = nacl.sign.keyPair.fromSeed(kp.secretKey.slice(0, 32));
  const address = bs58.encode(naclKp.publicKey);
  if (address !== kp.publicKey.toBase58()) throw new Error('nacl seed does not match the solana pubkey');
  return { kp, naclKp, address };
}
async function call(method, path, { body, cookie } = {}) {
  const r = await fetch(`${BASE}/api/${path}`, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, j: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
async function signIn(naclKp, address) {
  const { j } = await call('POST', 'auth/nonce', { body: { wallet: address } });
  const res = await call('POST', 'auth/verify', { body: { wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), naclKp.secretKey)) } });
  return res.cookie;
}
const phantom = (address, secret) => `(() => {
  const address = ${JSON.stringify(address)};
  const secret = Uint8Array.from(${JSON.stringify([...secret])});
  const key = () => ({ toString: () => address, toBase58: () => address });
  window.solana = { isPhantom: true, publicKey: key(),
    async connect() { this.publicKey = key(); return { publicKey: this.publicKey }; },
    async signAndSendTransaction(tx) {
      const web3 = window.solanaWeb3;
      if (!web3) throw new Error('web3 missing');
      const kp = web3.Keypair.fromSecretKey(secret);
      tx.partialSign(kp);
      const connection = new web3.Connection(${JSON.stringify(RPC)}, 'confirmed');
      const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      window.__paySig = signature;
      return { signature };
    },
    async disconnect() {} };
})();`;

const driverKp = nacl.sign.keyPair();
const driver = bs58.encode(driverKp.publicKey);
const spectator = walletOf(Keypair.generate());
const driverCookie = await signIn(driverKp, driver);
const fanCookie = await signIn(spectator.naclKp, spectator.address);
const connection = new Connection(RPC, 'confirmed');
const airdrop = await connection.requestAirdrop(spectator.kp.publicKey, 2 * LAMPORTS_PER_SOL);
await connection.confirmTransaction(airdrop, 'confirmed');

const treasury = new PublicKey(process.env.TREASURY_PUBKEY);
const funded = await connection.requestAirdrop(treasury, LAMPORTS_PER_SOL);
await connection.confirmTransaction(funded, 'confirmed');
const beforeDriver = await connection.getBalance(new PublicKey(driver));
const beforeTreasury = await connection.getBalance(treasury);
const rideId = randomUUID();
const prisma = new PrismaClient({ datasources: { db: { url: database } } });
const now = new Date(), startedAt = new Date(now.getTime() - 120000);
// Eligible historical replay fixture, not proof of an honest complete ride.
await prisma.ride.create({ data: { id: rideId, wallet: driver, tier: '1h', seed: 7, minSeconds: 3600, completeDist: 60000,
  status: 'failed', createdAt: startedAt, startedAt, endedAt: now, paidAt: startedAt,
  lastS: 600, lastT: 60, driveSeconds: 60, hull: 100, route: 'siberia', trip: '1h', startHour: 12 } });

const tab = await launch({ port: PORT, shotsDir: 'fc-solanapay-shots', evalProblems: true });
try {
  await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: phantom(spectator.address, spectator.kp.secretKey) });
  await tab.send('Network.enable');
  const [name, value] = fanCookie.split('=');
  await tab.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await tab.send('Page.navigate', { url: `${BASE}/play.html?watch=${rideId}` });
  check('watch page offers a chain tip', await until(async () => await tab.ev(`!!document.querySelector('#w-tips button[data-sol="0.01"]')`), 45000), await tab.ev('document.getElementById("w-me")?.textContent || ""'));
  await tab.ev(`document.querySelector('#w-tips button[data-sol="0.01"]').click()`);
  let sawQr = false;
  const paidUi = await until(async () => {
    if (await tab.ev('!!document.getElementById("w-qr")')) sawQr = true;
    return /Tip sent \(paid\)|Paid –/.test(await tab.ev('document.getElementById("w-msg")?.textContent || ""'));
  }, 90000);
  check('the pay QR was on screen before confirm', sawQr);
  check('the watch page reached the paid line', paidUi === true, await tab.ev('document.getElementById("w-msg")?.textContent || ""'));
  const row = await until(async () => {
    const found = await prisma.donationOrder.findFirst({ where: { rideId, wallet: spectator.address } });
    return found?.status === 'paid' ? found : null;
  }, 15000);
  check('DB donation order is paid (as-built; not confirmed)', row?.status === 'paid' && !!row.signature, JSON.stringify({ status: row?.status, signature: row?.signature }));
  if (!row) throw new Error('no paid donation');
  const driverGain = (await connection.getBalance(new PublicKey(driver))) - beforeDriver;
  const treasuryGain = (await connection.getBalance(treasury)) - beforeTreasury;
  const amount = Number(row.lamports), fee = Math.floor(amount * 500 / 10000);
  check('chain pays exactly 95% to the driver and 5% to treasury', driverGain === amount - fee && treasuryGain === fee, JSON.stringify({ amount, driverGain, treasuryGain }));
  const confirmed = await connection.getParsedTransaction(row.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  check('signed transaction confirmed without chain error', confirmed?.meta?.err === null);
  const again = await call('POST', `watch/${rideId}/donation-orders/${row.id}/confirm`, { cookie: fanCookie, body: { signature: row.signature } });
  check('duplicate confirmation is idempotent', again.status === 200 && again.j.status === 'paid' && await prisma.donationOrder.count({ where: { signature: row.signature } }) === 1);
  const sent = await call('GET', 'me/donations', { cookie: fanCookie });
  const received = await call('GET', 'me/donations', { cookie: driverCookie });
  check('sender history includes the confirmed tip', sent.status === 200 && sent.j.sent?.some(t => t.signature === row.signature && t.lamports === amount));
  check('driver history includes the confirmed tip', received.status === 200 && received.j.received?.some(t => t.signature === row.signature));
  const errors = pageErrors(tab);
  check('no page or console errors', errors.length === 0, errors.join(' | '));
  await tab.shot('solana-pay-paid');
} finally {
  await prisma.$disconnect().catch(() => {});
  await tab.close();
}
if (fails.length) { console.error(`FAILED ${fails.length}: ${fails.join(', ')}`); process.exit(1); }
console.log('e2e-solana-pay passed');
process.exit(0);
