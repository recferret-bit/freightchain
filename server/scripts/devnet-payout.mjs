// Pays a pool's ranked prizes and closes it with the ADMIN KEYPAIR FILE – the CLI stand-in for the admin page's payout buttons (not built yet).
// The server ranks (GET /api/pools/:id/payout – served only to TREASURY_PUBKEY, so this signs in as the admin), this script signs and sends each pay_prize,
// tells the server (POST /api/chain/settle), then the close_pool it offers once every rank is paid. Without --yes it only prints the plan.
//   bash server/scripts/devnet.sh payout <poolId> [--yes]        (BASE / RPC / the admin key from the devnet profile)
//   BASE=http://localhost:3000 RPC=<devnet url> ADMIN=<admin.json> node scripts/devnet-payout.mjs <poolId> [--yes]
// Refuses a mainnet RPC (the genesis hash must be devnet's or a local validator's).
import nacl from 'tweetnacl'; import bs58 from 'bs58'; import { readFileSync } from 'node:fs';
import { Connection, Keypair, Transaction } from '@solana/web3.js';

const { BASE, RPC, ADMIN } = process.env;
const poolId = Number(process.argv[2]), send = process.argv.includes('--yes');
if (!BASE || !RPC || !ADMIN || !Number.isInteger(poolId)) { console.error('usage: BASE=… RPC=… ADMIN=<admin.json> node scripts/devnet-payout.mjs <poolId> [--yes]'); process.exit(2); }
const MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const conn = new Connection(RPC, 'confirmed');
if ((await conn.getGenesisHash()) === MAINNET) { console.error('refusing a mainnet RPC'); process.exit(1); }
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(ADMIN, 'utf8'))));
const wallet = admin.publicKey.toBase58();
const sol = l => `${(l / 1e9).toFixed(6)} SOL`;
const api = async (path, { body, cookie } = {}) => {
  const r = await fetch(`${BASE}/api/${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ok: r.ok, j: await r.json().catch(() => ({})), r };
};

const { j: nonce } = await api('auth/nonce', { body: { wallet } });
const v = await api('auth/verify', { body: { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.message), admin.secretKey)) } });
if (!v.ok) { console.error(`sign-in as ${wallet} failed: ${v.status} ${JSON.stringify(v.j)}`); process.exit(1); }
const cookie = v.r.headers.get('set-cookie').split(';')[0];

const plan = async () => {
  const p = await api(`pools/${poolId}/payout`, { cookie });
  if (!p.ok) { console.error(`payout refused: ${p.status} ${p.j.code ?? ''} ${p.j.detail ?? p.j.title ?? ''}${p.status === 403 ? ' – this key is not TREASURY_PUBKEY' : ''}`); process.exit(1); }
  return p.j;
};
const sendTx = async b64 => {
  const tx = Transaction.from(Buffer.from(b64, 'base64')); tx.partialSign(admin);
  const sig = await conn.sendRawTransaction(tx.serialize()); await conn.confirmTransaction(sig, 'confirmed');
  for (let i = 0; i < 20; i++) { const s = await api('chain/settle', { body: { signature: sig }, cookie }); if (s.j.status === 'done') break; await new Promise(r => setTimeout(r, 1500)); }
  return sig;
};

let p = await plan();
console.log(`pool ${poolId}: prize cap ${sol(p.prizeLamports)}, ${p.ranks.length} ranked wallet(s)`);
for (const r of p.ranks) console.log(`  #${r.rank} ${r.wallet} · ${r.rides} ride(s) · ${r.distance} m · ${sol(r.lamports)}${r.paid ? ' · PAID' : ''}`);
if (!send) { console.log(`\n${p.transactions.length} pay_prize transaction(s) to sign${p.close ? ', then close_pool' : ''} – rerun with --yes to send them (the admin pays the fees).`); process.exit(0); }
for (const t of p.transactions) console.log(`  pay_prize #${t.rank} → ${t.to} ${sol(t.lamports)}: ${await sendTx(t.transaction)}`);
p = await plan();
if (!p.close) { console.log(p.transactions.length ? 'some ranks are still unpaid – run it again' : 'nothing to close (not every rank is paid yet?)'); process.exit(p.transactions.length ? 1 : 0); }
console.log(`  close_pool: ${await sendTx(p.close.transaction)}`);
console.log(`pool ${poolId} closed – fee / platform / seed treasuries and the creator's rent paid by the program (check: devnet.sh admin show --pool ${poolId})`);
