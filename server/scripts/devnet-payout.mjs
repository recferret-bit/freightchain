// Commits a pool's winners, pays its ranked prizes and closes it with the ADMIN KEYPAIR FILE – the CLI stand-in for the admin page's payout buttons.
// The server ranks (GET /api/pools/:id/payout – served only to TREASURY_PUBKEY, so this signs in as the admin), this script signs and sends what it offers,
// tells the server (POST /api/chain/settle). Without --yes it only prints the plan. Program v4 (pentest H5-B): from the PLAY deadline the ranking is first
// COMMITTED as a winners root (public until its lock ends – `payFrom`), then each rank is paid with its proof, then the pool closes. A committed root that is not
// the ranking any more is struck with --veto (only while no rank is paid); run it again to commit the ranking. Before the play deadline / payFrom it waits on the
// CHAIN clock when that is at most PAYOUT_WAIT_MAX seconds away (default 900), else says when and stops. The server's own payout job (PAYOUT_SECRET, `pool:payout`)
// is the normal path once the program names a payout key; this stays the admin's manual stand-in.
//   bash server/scripts/devnet.sh payout <poolId> [--yes] [--veto]        (BASE / RPC / the admin key from the devnet profile)
//   BASE=http://localhost:3000 RPC=<devnet url> ADMIN=<admin.json> node scripts/devnet-payout.mjs <poolId> [--yes] [--veto]
// Refuses a mainnet RPC (the genesis hash must be devnet's or a local validator's).
import nacl from 'tweetnacl'; import bs58 from 'bs58'; import { readFileSync } from 'node:fs';
import { Connection, Keypair, SYSVAR_CLOCK_PUBKEY, Transaction } from '@solana/web3.js';

const { BASE, RPC, ADMIN } = process.env;
const poolId = Number(process.argv[2]), send = process.argv.includes('--yes'), veto = process.argv.includes('--veto');
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

const chainNow = async () => Number((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed')).data.readBigInt64LE(32));
const info = await api(`pools/${poolId}`);
if (!info.ok) { console.error(`no pool ${poolId} on the server: ${info.status} ${info.j.detail ?? ''}`); process.exit(1); }
const waitMax = +(process.env.PAYOUT_WAIT_MAX || 900);
/** wait for `at` (unix s) on the chain clock, or say when and stop */
const waitFor = async (at, what) => {
  let left = at - (await chainNow());
  if (left <= 0) return;
  console.log(`pool ${poolId}: ${what} ${new Date(at * 1000).toISOString()} (in ${left} s on the chain clock)`);
  if (left > waitMax) { console.log(`more than ${waitMax} s away: run it again then (PAYOUT_WAIT_MAX raises the wait)`); process.exit(send ? 1 : 0); }
  while ((left = at - (await chainNow())) >= 0) await new Promise(r => setTimeout(r, Math.min(5000, (left + 1) * 1000)));
  for (let i = 0; i < 10 && (await api(`pools/${poolId}/payout`, { cookie })).status === 409; i++) await new Promise(r => setTimeout(r, 1000));   // the server judges by its own clock
};
await waitFor(Math.ceil(info.j.playDeadline / 1000), 'the rides are over');

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
console.log(`pool ${poolId}: prize cap ${sol(p.prizeLamports)}, ${p.ranks.length} ranked wallet(s)${p.committedRoot ? `, root ${p.committedRoot} committed (pays from ${new Date(p.payFrom).toISOString()})` : ', nothing committed yet'}`);
for (const r of p.ranks) console.log(`  #${r.rank} ${r.wallet} · ${r.rides} ride(s) · ${r.distance} m · ${sol(r.lamports)}${r.paid ? ' · PAID' : ''}`);
if (p.note) console.log(`  ${p.note}`);
if (!send) { console.log(`\n${p.commit ? 'commit_winners' : p.transactions.length ? `${p.transactions.length} pay_prize transaction(s)` : p.close ? 'close_pool' : 'nothing'} to sign${p.veto ? ' (veto_winners offered: --veto)' : ''} – rerun with --yes to send (the admin pays the fees).`); process.exit(0); }
if (veto) {
  if (!p.veto) { console.error('nothing to veto (no committed root, or a rank is paid already)'); process.exit(1); }
  console.log(`  veto_winners: ${await sendTx(p.veto.transaction)} – run it again to commit the ranking`);
  process.exit(0);
}
if (p.commit) {
  console.log(`  commit_winners: ${await sendTx(p.commit.transaction)}`);
  p = await plan();
}
if (!p.committedRoot) { console.error('the commit did not land – run it again'); process.exit(1); }
if (!p.transactions.length && !p.close && p.payFrom) { await waitFor(Math.ceil(p.payFrom / 1000), 'the winners are public until'); p = await plan(); }
if (p.note && !p.transactions.length && !p.close) { console.error(p.note); process.exit(1); }
for (const t of p.transactions) console.log(`  pay_prize #${t.rank} → ${t.to} ${sol(t.lamports)}: ${await sendTx(t.transaction)}`);
p = await plan();
if (!p.close) { console.log(p.transactions.length ? 'some ranks are still unpaid – run it again' : 'nothing to close (not every rank is paid yet?)'); process.exit(p.transactions.length ? 1 : 0); }
console.log(`  close_pool: ${await sendTx(p.close.transaction)}`);
console.log(`pool ${poolId} closed – fee / platform / seed treasuries and the creator's rent paid by the program (check: devnet.sh admin show --pool ${poolId})`);
