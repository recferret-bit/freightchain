/* Keypair-file calls to pool-admin on the block-2 validator. The payer is chain-init's ledger key, never the global solana id. */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { REPO } from '../harness/dom.mjs';
import { SOLANA, devAdmin, session, signInAdmin, adminSign, signInPlayer } from '../harness/api.mjs';

const exec = promisify(execFile);
const SERVER = join(REPO, 'backend/server');
const LEDGER = join(REPO, 'tests/e2e/.ledger');
const PAYER = join(LEDGER, 'keys/payer.json');

function pub(file) {
  return execFile('solana-keygen', ['pubkey', file], { encoding: 'utf8' }).then((r) => r.stdout.trim());
}

async function adminCli(args) {
  const keyed = args.includes('-k') ? args : [...args, '-k', PAYER];
  const { stdout, stderr } = await exec('node', ['scripts/pool-admin.mjs', ...keyed, '--url', SOLANA], { cwd: SERVER });
  const line = stdout.trim().split('\n').filter(Boolean).at(-1);
  if (!line) throw new Error(stderr || 'pool-admin printed nothing');
  return JSON.parse(line);
}

async function balance(address) {
  const r = await fetch(SOLANA, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
  });
  const body = await r.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result.value;
}

let ready;
export function ensureChain() {
  ready ??= (async () => {
    const admin = await pub(PAYER);
    let show = await adminCli(['show']);
    if (!show.config) {
      show = await adminCli(['initialize', '--admin', admin, '--platform-treasury', admin, '--platform-fee-bps', '0']);
    }
    await adminCli(['set-config', '--min-review-secs', '0', '--min-finish-secs', '0']);
    return { admin, show };
  })();
  return ready;
}

export async function liveSetPoolRules() {
  await ensureChain();
  const off = await adminCli(['set-pool-rules', '--paid', 'false', '--split', '8500/500/1000', '--max-player-share', '4740']);
  if (off.config.paidTicketsEnabled !== false) throw new Error(`paid still on: ${JSON.stringify(off.config)}`);
  if (off.config.prizeBps !== 8500 || off.config.seedBps !== 500 || off.config.feeBps !== 1000) throw new Error(JSON.stringify(off.config));
  const on = await adminCli(['set-pool-rules', '--paid', 'true', '--split', '8500/500/1000', '--max-player-share', '4740']);
  if (on.config.paidTicketsEnabled !== true) throw new Error('paid tickets did not turn back on');
}

export async function redeemTicketPromo() {
  const { admin } = await ensureChain();
  const made = await adminCli(['create-pool', '--tier', '1h', '--price', '1000000', '--min', '1', '--max', '0', '--per-wallet', '4',
    '--prep', '+120', '--play', '+240', '--fee-treasury', admin, '--seed-treasury', admin, '--split', '8500/500/1000']);
  await exec('node', ['dist/cli/index.js', 'pool:register', String(made.poolId)], { cwd: SERVER, env: process.env });
  const api = session();
  const keys = await signInAdmin(api, devAdmin());
  const code = `POOL${Date.now().toString(36).toUpperCase()}`;
  const promo = { code, effect: { kind: 'tickets', tier: '1h', poolId: made.poolId, credits: 1 }, description: null, maxRedemptions: 2, perWallet: 1, startsAt: null, expiresAt: null, note: null };
  const signature = await adminSign(api, keys, '/api/admin/promos/challenge', { action: 'promo_create', promo });
  const created = await api.call('/api/admin/promos', { body: { promo, signature }, headers: { 'x-fc-admin': '1' } });
  if (created.status !== 200) throw new Error(JSON.stringify(created.json));
  const player = session();
  await signInPlayer(player);
  const redeemed = await player.call('/api/promo/redeem', { body: { code } });
  if (redeemed.status !== 200) throw new Error(JSON.stringify(redeemed.json));
  if (redeemed.json.kind !== 'tickets' || redeemed.json.added !== 1 || redeemed.json.poolId !== made.poolId) throw new Error(JSON.stringify(redeemed.json));
}

export async function payWinners() {
  const { admin } = await ensureChain();
  const buyerFile = join(LEDGER, 'keys/buyer.json');
  await exec('solana-keygen', ['new', '-s', '--no-bip39-passphrase', '--force', '-o', buyerFile]);
  const buyer = await pub(buyerFile);
  await exec('solana', ['airdrop', '--url', SOLANA, '--keypair', PAYER, '5', buyer]);
  const before = await balance(buyer);
  const pool = await adminCli(['create-pool', '--tier', '1h', '--price', '1000000', '--min', '1', '--max', '0', '--per-wallet', '2',
    '--prep', '+40', '--play', '+70', '--fee-treasury', admin, '--seed-treasury', admin]);
  const bought = await adminCli(['buy', '-k', buyerFile, '--pool', String(pool.poolId), '--qty', '1']);
  if (!bought.signature) throw new Error(JSON.stringify(bought));
  const after = await balance(buyer);
  if (before - after < 1_000_000) throw new Error(`buyer paid ${before - after}, want at least the 1000000 price`);
  await adminCli(['sponsor', '--pool', String(pool.poolId), '--lamports', '500000']);
  await new Promise((r) => setTimeout(r, 12_000));
  await adminCli(['seal-road', '--pool', String(pool.poolId)]);
  const ride = '33333333-3333-4333-8333-333333333333';
  await adminCli(['set-payout-authority', '--payout', admin]);
  await new Promise((r) => setTimeout(r, 70_000));
  await adminCli(['record-ride-attestation', '--pool', String(pool.poolId), '--ride', ride, '--driver', buyer, '--km', '1', '--status', 'verified']);
  await adminCli(['commit-winners', '--pool', String(pool.poolId), '--winners', `${buyer}:100000`]);
  await new Promise((r) => setTimeout(r, 3_000));
  const paid = await adminCli(['pay-prize', '--pool', String(pool.poolId), '--winners', `${buyer}:100000`, '--rank', '1']);
  if (!paid.signature && !paid.pool) throw new Error(JSON.stringify(paid));
  await adminCli(['close-pool', '--pool', String(pool.poolId)]);
  const closed = await adminCli(['show', '--pool', String(pool.poolId)]);
  const row = closed.pools?.find((p) => p.id === pool.poolId);
  if (!row || row.status !== 3) throw new Error(JSON.stringify(row ?? closed));
}

export async function ledgerMatchesChain() {
  const player = session();
  await signInPlayer(player);
  const honk = await player.call('/api/honk');
  if (honk.status !== 200) throw new Error(JSON.stringify(honk.json));
  const minted = BigInt(String(honk.json.minted ?? '0').split('.')[0]);
  const program = 'GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx';
  const info = await fetch(SOLANA, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [program, { encoding: 'base64' }] }),
  }).then((r) => r.json());
  const deployed = info.result?.value?.executable === true;
  if (!deployed && minted !== 0n) throw new Error(`ledger minted ${minted} but the TEN4 program is not on this validator`);
  if (!deployed) return;
  if (minted !== 0n) throw new Error(`fresh wallet ledger minted ${minted}; chain mint was not exercised`);
}
