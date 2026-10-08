// Admin CLI for the escrow program (programs/freightchain-pools) with KEYPAIR FILES – the instructions the server never builds: initialize, create_pool,
// set_config, close_pool (+ show). Encodes through the server's own codec (dist/, so `npm run build` first) from the vendored IDL. Run from server/:
//   node scripts/pool-admin.mjs show        --url <rpc> [--pool N]
//   node scripts/pool-admin.mjs initialize  --url <rpc> -k <upgrade-authority.json> --admin <pubkey> --platform-treasury <pubkey> [--platform-fee-bps 0]
//   node scripts/pool-admin.mjs create-pool --url <rpc> -k <admin.json> --tier 1h|4h|8h --price <lamports> --min N [--max 0] [--per-wallet 1]
//                                           --prep <unix|+secs> --play <unix|+secs> [--split 7000/2000/1000] --fee-treasury <pubkey> --seed-treasury <pubkey>
//   node scripts/pool-admin.mjs set-config  --url <rpc> -k <admin.json> [--paused true|false] [--platform-treasury <pubkey>] [--platform-fee-bps N]
//   node scripts/pool-admin.mjs close-pool  --url <rpc> -k <caller.json> --pool N        (admin after play_deadline; anyone for a fully refunded pool)
//   node scripts/pool-admin.mjs sponsor     --url <rpc> -k <sponsor.json> --pool N --lamports L   (anyone; split like ticket money)
//   node scripts/pool-admin.mjs buy         --url <rpc> -k <buyer.json> [--fee-payer <payer.json>] --pool N [--qty 1]   (no server order: tests / fixtures)
//   node scripts/pool-admin.mjs pay-prize   --url <rpc> -k <admin.json> --pool N --to <pubkey> --lamports L [--rank 1]
//   node scripts/pool-admin.mjs fail-pool | expire-pool --url <rpc> -k <caller.json> --pool N   (permissionless cranks)
// --program <id> (default: the IDL address). `+secs` is relative to the CHAIN clock (Clock sysvar), not this machine's. Prints one JSON line.
// Never reads the global Solana config: --url and -k are required; a mainnet URL is refused. Phantom-signed admin actions are not covered here (keypair files only).
import { readFileSync } from 'node:fs'; import crypto from 'node:crypto';
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { POOL_PROGRAM_IDL } from '../dist/infrastructure/solana/pool-program.idl.js';

const [cmd, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i++) {
  const k = rest[i].replace(/^-+/, ''), v = rest[i + 1];
  if (v === undefined || v.startsWith('--')) { opt[k] = 'true'; continue; }
  opt[k === 'k' ? 'keypair' : k] = v; i++;
}
const die = msg => { console.error(`pool-admin: ${msg}`); process.exit(1); };
if (!cmd || cmd === 'help') die('commands: show | initialize | create-pool | set-config | close-pool | sponsor | buy | pay-prize | fail-pool | expire-pool (see the header of scripts/pool-admin.mjs)');
if (!opt.url) die('--url <rpc> is required (never the global config)');
if (/mainnet/i.test(opt.url)) die('refusing a mainnet RPC – the program is devnet only, not audited');

const conn = new Connection(opt.url, 'confirmed');
const codec = new PoolProgramCodec(opt.program ?? POOL_PROGRAM_IDL.address);
const UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const TIERS = { '1h': 1, '4h': 2, '8h': 3 };   // CHAIN_TIER_CODES (domain/economy/chain-events.ts)
const keypair = () => {
  if (!opt.keypair) die('-k <keypair.json> is required');
  return file(opt.keypair);
};
const pk = name => { if (!opt[name]) die(`--${name} <pubkey> is required`); return new PublicKey(opt[name]).toBase58(); };
const int = (name, dflt) => { const v = opt[name] ?? dflt; if (v === undefined || !/^\d+$/.test(String(v))) die(`--${name} needs a whole number`); return Number(v); };
const chainNow = async () => Number((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY)).data.readBigInt64LE(32));   // Clock.unix_timestamp
const when = async name => { const v = opt[name]; if (!v) die(`--${name} <unix|+secs> is required`); return v.startsWith('+') ? (await chainNow()) + Number(v.slice(1)) : Number(v); };
const account = async (name, address) => { const a = await conn.getAccountInfo(address); return a ? codec.decodeAccount(name, a.data) : null; };
const config = () => account('Config', codec.configPda());
const send = async (signer, ix, more = []) => sendAndConfirmTransaction(conn, new Transaction().add(ix), [signer, ...more], { commitment: 'confirmed' });
const file = path => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
const out = o => console.log(JSON.stringify(o, (_, v) => (v instanceof PublicKey ? v.toBase58() : typeof v === 'bigint' ? Number(v) : v)));

try {
  if (cmd === 'show') {
    const c = await config();
    if (!c) { out({ program: codec.programId, config: null }); process.exit(0); }
    const ids = opt.pool !== undefined ? [int('pool')] : [...Array(c.poolCount).keys()];
    const pools = [];
    for (const id of ids) pools.push({ id, vaultLamports: (await conn.getBalance(codec.vaultPda(id))), ...(await account('Pool', codec.poolPda(id))) });
    out({ program: codec.programId, now: await chainNow(), config: c, pools });
  } else if (cmd === 'initialize') {
    const upgrader = keypair();
    const programData = PublicKey.findProgramAddressSync([codec.programId.toBuffer()], UPGRADEABLE_LOADER)[0];
    const sig = await send(upgrader, codec.instruction('initialize', {
      upgrade_authority: upgrader.publicKey, program: codec.programId, program_data: programData, config: codec.configPda(), platform_treasury_account: pk('platform-treasury'),
    }, { authority: pk('admin'), platform_treasury: pk('platform-treasury'), platform_fee_bps: int('platform-fee-bps', 0) }));
    out({ signature: sig, config: await config() });
  } else if (cmd === 'create-pool') {
    const admin = keypair();
    const c = await config(); if (!c) die('no Config – run initialize first');
    const tier = TIERS[opt.tier]; if (!tier) die('--tier must be 1h, 4h or 8h');
    const [prize, seed, fee] = (opt.split ?? '7000/2000/1000').split('/').map(Number);
    const id = c.poolCount;
    const sig = await send(admin, codec.instruction('create_pool', {
      authority: admin.publicKey, config: codec.configPda(), pool: codec.poolPda(id), vault: codec.vaultPda(id),
      fee_treasury: pk('fee-treasury'), seed_treasury: pk('seed-treasury'), platform_treasury: c.platformTreasury,
    }, { params: { tier, price_lamports: int('price'), min_tickets: int('min'), max_tickets: int('max', 0), max_per_wallet: int('per-wallet', 1),
      prep_deadline: await when('prep'), play_deadline: await when('play'), prize_bps: prize, seed_bps: seed, fee_bps: fee } }));
    out({ signature: sig, poolId: id, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'set-config') {
    const admin = keypair();
    const bool = v => (v === undefined ? null : v === 'true');
    const sig = await send(admin, codec.instruction('set_config', {
      authority: admin.publicKey, config: codec.configPda(), new_platform_treasury: opt['platform-treasury'] ?? admin.publicKey,
    }, { paused: bool(opt.paused), platform_treasury: opt['platform-treasury'] ?? null, platform_fee_bps: opt['platform-fee-bps'] === undefined ? null : int('platform-fee-bps') }));
    out({ signature: sig, config: await config() });
  } else if (cmd === 'close-pool') {
    const caller = keypair(), id = int('pool');
    const p = await account('Pool', codec.poolPda(id)); if (!p) die(`no pool ${id}`);
    const c = await config();
    const sig = await send(caller, codec.instruction('close_pool', {
      caller: caller.publicKey, pool_authority: p.authority, config: codec.configPda(), pool: codec.poolPda(id), vault: codec.vaultPda(id),
      seed_treasury: p.seedTreasury, fee_treasury: p.feeTreasury, platform_treasury: c.platformTreasury,
    }, { pool_id: id }));
    out({ signature: sig, pool: await account('Pool', codec.poolPda(id)), vaultLamports: await conn.getBalance(codec.vaultPda(id)) });
  } else if (cmd === 'sponsor') {
    const who = keypair(), id = int('pool');
    const sig = await send(who, codec.instruction('sponsor', { sponsor: who.publicKey, config: codec.configPda(), pool: codec.poolPda(id), vault: codec.vaultPda(id) }, { pool_id: id, lamports: int('lamports') }));
    out({ signature: sig, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'buy') {
    const buyer = keypair(), payer = opt['fee-payer'] ? file(opt['fee-payer']) : buyer, id = int('pool');
    const orderId = Uint8Array.from(Buffer.from(crypto.randomUUID().replace(/-/g, ''), 'hex'));
    const sig = await send(payer, codec.instruction('buy_ticket', {
      buyer: buyer.publicKey, fee_payer: payer.publicKey, config: codec.configPda(), pool: codec.poolPda(id), vault: codec.vaultPda(id), ticket: codec.ticketPda(id, buyer.publicKey),
    }, { pool_id: id, qty: int('qty', 1), order_id: orderId }), payer === buyer ? [] : [buyer]);
    out({ signature: sig, ticket: await account('Ticket', codec.ticketPda(id, buyer.publicKey)) });
  } else if (cmd === 'pay-prize') {
    const admin = keypair(), id = int('pool');
    const sig = await send(admin, codec.instruction('pay_prize', { authority: admin.publicKey, config: codec.configPda(), pool: codec.poolPda(id), vault: codec.vaultPda(id), to: pk('to') },
      { pool_id: id, lamports: int('lamports'), rank: int('rank', 1) }));
    out({ signature: sig, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'fail-pool' || cmd === 'expire-pool') {
    const who = keypair(), id = int('pool');
    const sig = await send(who, codec.instruction(cmd.replace('-', '_'), { caller: who.publicKey, pool: codec.poolPda(id) }, { pool_id: id }));
    out({ signature: sig, pool: await account('Pool', codec.poolPda(id)) });
  } else die(`unknown command ${cmd}`);
} catch (e) {
  const logs = e?.transactionLogs ?? e?.logs;
  die(`${e?.message ?? e}${logs ? `\n  ${logs.join('\n  ')}` : ''}`);
}
