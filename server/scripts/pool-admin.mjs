// Admin CLI for the escrow program (programs/freightchain-pools) with KEYPAIR FILES – the instructions the server never builds: initialize, create_pool,
// set_config, close_pool (+ show). Encodes through the server's own codec (dist/, so `npm run build` first) from the vendored IDL. Run from server/:
//   node scripts/pool-admin.mjs show        --url <rpc> [--pool N]
//   node scripts/pool-admin.mjs initialize  --url <rpc> -k <upgrade-authority.json> --admin <pubkey> --platform-treasury <pubkey> [--platform-fee-bps 0]
//   node scripts/pool-admin.mjs create-pool --url <rpc> -k <admin.json> --tier 1h|4h|8h --price <lamports> [--min N] [--max 0] [--per-wallet 1]
//                                           1h omits --min → 20 (ride-tier.ts). A smaller --min is a short test pool. 4h and 8h still require --min.
//                                           --prep <unix|+secs> --play <unix|+secs> [--payout <unix|+secs> (default = --play)] [--split 7000/2000/1000] --fee-treasury <pubkey> --seed-treasury <pubkey>
//   node scripts/pool-admin.mjs set-series  --url <rpc> -k <admin.json> --tier 1h|4h|8h --price <lamports> [--min N] [--max 0] [--per-wallet 1] [--split 7000/2000/1000]
//                                           [--sale-hours H --play-hours H --review-hours H] (1h default: the tier table's schedule, 24 / 2 / 48; --sale-secs / --play-secs / --review-secs
//                                           give seconds instead – the program still wants a sale window of at least an hour) --fee-treasury <pubkey> --seed-treasury <pubkey>
//                                           [--start <unix|+secs>] (required for a new series; omitted = keep its schedule) [--enabled true|false]
//   node scripts/pool-admin.mjs open-next-pool --url <rpc> -k <caller.json> --tier 1h   (permissionless once the series' slot has come – the crank does it; the caller pays the rents)
//   node scripts/pool-admin.mjs set-payout-authority --url <rpc> -k <admin.json> --payout <pubkey> | --clear   (commits winners, records ride attestations, closes paid pools)
//   node scripts/pool-admin.mjs set-config  --url <rpc> -k <admin.json> [--paused true|false] [--platform-treasury <pubkey>] [--platform-fee-bps N]
//                                           [--min-review-secs S] [--min-finish-secs S]   (v4 floors for NEW pools / series; localnet sets them tiny)
//   node scripts/pool-admin.mjs migrate-config --url <rpc> -k <admin.json>    (v4: once, right after the upgrade – the v3 Config grows, floors at their defaults)
//   node scripts/pool-admin.mjs seal-road   --url <rpc> -k <caller.json> --pool N    (v4, permissionless: the road from a slot after the pool opened – the crank does it)
//   node scripts/pool-admin.mjs close-pool  --url <rpc> -k <caller.json> --pool N        (admin / payout key once every committed rank is paid; anyone after the grace / for a refunded pool)
//   node scripts/pool-admin.mjs sponsor     --url <rpc> -k <sponsor.json> --pool N --lamports L   (anyone; split like ticket money)
//   node scripts/pool-admin.mjs buy         --url <rpc> -k <buyer.json> [--fee-payer <payer.json>] --pool N [--qty 1]   (no server order: tests / fixtures)
//   node scripts/pool-admin.mjs commit-winners --url <rpc> -k <admin-or-payout.json> --pool N --winners <wallet:lamports,…|file.json>   (v4: past the play deadline; rank = order;
//                                           an empty list (`--winners none`) = no winner)
//   node scripts/pool-admin.mjs veto-winners --url <rpc> -k <admin.json> --pool N   (v4, the cold admin only, while no committed rank is paid)
//   node scripts/pool-admin.mjs pay-prize   --url <rpc> -k <anyone.json> --pool N --winners <the committed list> --rank R   (v4, permissionless from the pool's pay_from; R 1-based)
//   node scripts/pool-admin.mjs record-ride-attestation --url <rpc> -k <admin-or-payout.json> --pool N --ride <uuid> --driver <pubkey> --km K [--status verified|flagged|unverified] [--root <64 hex>]
//                                           (v4, Active pool: the verdict on ONE pledged ride – settle_pledge reads it; the payout job writes it itself)
//   node scripts/pool-admin.mjs close-ride-attestation --url <rpc> -k <caller.json> --pool N --ride <uuid>   ·  close-attestation … --pool N --driver <pubkey> (a v3 one)
//   node scripts/pool-admin.mjs refund-sponsor | close-sponsor-receipt --url <rpc> -k <caller.json> --pool N --sponsor <pubkey>   (v4, permissionless: Refunding / Settled pool)
//   node scripts/pool-admin.mjs create-pledge --url <rpc> -k <sponsor.json> --pool N --ride <uuid> --driver <pubkey> --per-km L --km K   (no server row: tests)
//   node scripts/pool-admin.mjs settle-pledge | refund-pledge --url <rpc> -k <caller.json> --pool N --ride <uuid> --sponsor <pubkey> --driver <pubkey>   (permissionless)
//   node scripts/pool-admin.mjs fail-pool | expire-pool --url <rpc> -k <caller.json> --pool N   (permissionless cranks)
//   node scripts/pool-admin.mjs refund      --url <rpc> -k <caller.json> --pool N --buyer <pubkey> [--rent-payer <pubkey>]   (permissionless: price → buyer, Ticket rent → its rent_payer)
//   node scripts/pool-admin.mjs close-ticket --url <rpc> -k <caller.json> --pool N --buyer <pubkey>  (permissionless, Settled pool: Ticket rent → its rent_payer)
//   node scripts/pool-admin.mjs cancel-pool --url <rpc> -k <admin.json> --pool N                    (admin, Open pool → Refunding)
//   node scripts/pool-admin.mjs propose-authority --url <rpc> -k <admin.json> --new <pubkey>  ·  accept-authority --url <rpc> -k <new-admin.json>
// --program <id> (default: the IDL address). `+secs` is relative to the CHAIN clock (Clock sysvar), not this machine's. Prints one JSON line.
// Never reads the global Solana config: --url and -k are required; a mainnet URL is refused. Phantom-signed admin actions are not covered here (keypair files only).
import { readFileSync } from 'node:fs'; import crypto from 'node:crypto';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { POOL_PROGRAM_IDL } from '../dist/infrastructure/solana/pool-program.idl.js';
import { rideTier } from '../dist/domain/rides/ride-tier.js';
import { winnersTree } from '../dist/domain/economy/winners-merkle.js';

const [cmd, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i++) {
  const k = rest[i].replace(/^-+/, ''), v = rest[i + 1];
  if (v === undefined || v.startsWith('--')) { opt[k] = 'true'; continue; }
  opt[k === 'k' ? 'keypair' : k] = v; i++;
}
const die = msg => { console.error(`pool-admin: ${msg}`); process.exit(1); };
if (!cmd || cmd === 'help') die('commands: show | initialize | create-pool | set-series | open-next-pool | set-payout-authority | set-config | migrate-config | seal-road | close-pool | sponsor | buy | commit-winners | veto-winners | pay-prize | record-ride-attestation | close-ride-attestation | close-attestation | create-pledge | settle-pledge | refund-pledge | refund-sponsor | close-sponsor-receipt | fail-pool | expire-pool | refund | close-ticket | cancel-pool | propose-authority | accept-authority (see the header of scripts/pool-admin.mjs)');
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
// v4 winners: `wallet:lamports,…` or a JSON file of [{ wallet, lamports }] (rank = order) → the program's root and proofs (the server's winners-merkle.ts)
const sha = d => crypto.createHash('sha256').update(d).digest();
const winnersOf = (id) => {
  const v = opt.winners ?? die('--winners <wallet:lamports,…|file.json|none> is required');
  const list = v === 'none' ? [] : v.endsWith('.json') ? JSON.parse(readFileSync(v, 'utf8')) : v.split(',').map(x => { const [wallet, lamports] = x.split(':'); return { wallet, lamports: Number(lamports) }; });
  return { list, ...winnersTree(id, list.map(w => ({ wallet: new PublicKey(w.wallet).toBase58(), lamports: Number(w.lamports) })), sha) };
};
const rideIdOf = () => { const b = Buffer.alloc(32); Buffer.from(String(opt.ride ?? die('--ride <uuid>')).replace(/-/g, ''), 'hex').copy(b); return b; };   // the server's rideIdToBytes
// a small priority fee + re-send every 2 s until confirmed; a fresh blockhash when one expires (a real cluster drops some transactions) – up to 3 tries
const PRIORITY = +(process.env.PRIORITY_MICROLAMPORTS || 5_000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function send(signer, ix, more = []) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }), ix);
    tx.sign(signer, ...more);
    const sim = await conn.simulateTransaction(tx);
    if (sim.value.err) throw Object.assign(new Error(`simulation failed: ${JSON.stringify(sim.value.err)}`), { logs: sim.value.logs ?? [] });
    const raw = tx.serialize(), sig = bs58.encode(tx.signature);
    for (;;) {
      await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
      await sleep(2_000);
      const st = (await conn.getSignatureStatuses([sig])).value[0];
      if (st?.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(st.err)}`);
      if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return sig;
      if (!st && (await conn.getBlockHeight('confirmed')) > lastValidBlockHeight) break;   // dropped: new blockhash
    }
  }
  throw new Error('not confirmed after 3 blockhashes – the cluster is dropping transactions; try again');
}
const file = path => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
const out = o => console.log(JSON.stringify(o, (_, v) => (v instanceof PublicKey ? v.toBase58() : typeof v === 'bigint' ? Number(v) : v)));

try {
  if (cmd === 'show') {
    const c = await config();
    if (!c) { out({ program: codec.programId, config: null }); process.exit(0); }
    const ids = opt.pool !== undefined ? [int('pool')] : [...Array(c.poolCount).keys()];
    const pools = [];
    for (const id of ids) pools.push({ id, vaultLamports: (await conn.getBalance(codec.vaultPda(id))), ...(await account('Pool', codec.poolPda(id))) });
    const series = [];
    for (const [name, tier] of Object.entries(TIERS)) { const sr = await account('Series', codec.seriesPda(tier)); if (sr) series.push({ tier: name, ...sr }); }
    out({ program: codec.programId, now: await chainNow(), config: c, series, pools });
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
    const prep = await when('prep'), play = await when('play');   // read once: a default payout_at = this exact play deadline (a second `+secs` read could land a second later)
    const sig = await send(admin, codec.instruction('create_pool', {
      authority: admin.publicKey, config: codec.configPda(), pool: codec.poolPda(id), vault: codec.vaultPda(id),
      fee_treasury: pk('fee-treasury'), seed_treasury: pk('seed-treasury'), platform_treasury: c.platformTreasury,
    }, { params: { tier, price_lamports: int('price'), min_tickets: int('min', opt.tier === '1h' ? rideTier('1h', 0).minTickets : undefined), max_tickets: int('max', 0), max_per_wallet: int('per-wallet', 1),
      prep_deadline: prep, play_deadline: play, payout_at: opt.payout ? await when('payout') : play, prize_bps: prize, seed_bps: seed, fee_bps: fee } }));
    out({ signature: sig, poolId: id, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'set-series') {
    const admin = keypair();
    const c = await config(); if (!c) die('no Config – run initialize first');
    const tier = TIERS[opt.tier]; if (!tier) die('--tier must be 1h, 4h or 8h');
    const def = rideTier(opt.tier, 0);
    const sched = def.schedule ?? {};
    const secs = (name, d) => (opt[name.replace('hours', 'secs')] !== undefined ? int(name.replace('hours', 'secs')) : int(name, d) * 3600);   // --sale-secs etc. win over --sale-hours
    const [prize, seed, fee] = (opt.split ?? '7000/2000/1000').split('/').map(Number);
    const existing = await account('Series', codec.seriesPda(tier));
    if (!existing && !opt.start) die('a new series needs --start <unix|+secs> (the first sale slot)');
    const sig = await send(admin, codec.instruction('set_series', {
      authority: admin.publicKey, config: codec.configPda(), series: codec.seriesPda(tier), fee_treasury: pk('fee-treasury'), seed_treasury: pk('seed-treasury'), platform_treasury: c.platformTreasury,
    }, { params: { tier, enabled: opt.enabled === undefined ? true : opt.enabled === 'true', price_lamports: int('price'), min_tickets: int('min', def.minTickets ?? undefined),
      max_tickets: int('max', 0), max_per_wallet: int('per-wallet', 1), sale_secs: secs('sale-hours', sched.saleHours), play_secs: secs('play-hours', sched.playHours),
      verify_secs: secs('review-hours', sched.reviewHours), prize_bps: prize, seed_bps: seed, fee_bps: fee, start_at: opt.start ? await when('start') : 0 } }));
    out({ signature: sig, series: await account('Series', codec.seriesPda(tier)) });
  } else if (cmd === 'open-next-pool') {
    const caller = keypair();
    const tier = TIERS[opt.tier]; if (!tier) die('--tier must be 1h, 4h or 8h');
    const c = await config(); if (!c) die('no Config – run initialize first');
    const sr = await account('Series', codec.seriesPda(tier)); if (!sr) die(`tier ${opt.tier} has no series – set-series first`);
    const id = c.poolCount;
    const sig = await send(caller, codec.instruction('open_next_pool', {
      caller: caller.publicKey, config: codec.configPda(), series: codec.seriesPda(tier), pool: codec.poolPda(id), vault: codec.vaultPda(id),
      fee_treasury: sr.feeTreasury, seed_treasury: sr.seedTreasury, platform_treasury: c.platformTreasury,
    }, { tier }));
    out({ signature: sig, poolId: id, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'set-payout-authority') {
    const admin = keypair();
    if (!opt.payout && opt.clear !== 'true') die('--payout <pubkey> or --clear');
    const sig = await send(admin, codec.instruction('set_payout_authority', { authority: admin.publicKey, config: codec.configPda() }, { payout_authority: opt.clear === 'true' ? null : pk('payout') }));
    out({ signature: sig, config: await config() });
  } else if (cmd === 'set-config') {
    const admin = keypair();
    const bool = v => (v === undefined ? null : v === 'true');
    const sig = await send(admin, codec.instruction('set_config', {
      authority: admin.publicKey, config: codec.configPda(), new_platform_treasury: opt['platform-treasury'] ?? admin.publicKey,
    }, { paused: bool(opt.paused), platform_treasury: opt['platform-treasury'] ?? null, platform_fee_bps: opt['platform-fee-bps'] === undefined ? null : int('platform-fee-bps'),
      min_review_secs: opt['min-review-secs'] === undefined ? null : int('min-review-secs'), min_finish_secs: opt['min-finish-secs'] === undefined ? null : int('min-finish-secs') }));
    out({ signature: sig, config: await config() });
  } else if (cmd === 'migrate-config') {
    const admin = keypair();
    const sig = await send(admin, codec.instruction('migrate_config_v4', { authority: admin.publicKey, config: codec.configPda() }, {}));
    out({ signature: sig, config: await config() });
  } else if (cmd === 'seal-road') {
    const caller = keypair(), id = int('pool');
    const sig = await send(caller, codec.instruction('seal_road', { caller: caller.publicKey, pool: codec.poolPda(id) }, { pool_id: id }));
    out({ signature: sig, pool: await account('Pool', codec.poolPda(id)) });
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
    const sig = await send(who, codec.instruction('sponsor', { sponsor: who.publicKey, config: codec.configPda(), pool: codec.poolPda(id), vault: codec.vaultPda(id),
      receipt: codec.sponsorReceiptPda(id, who.publicKey) }, { pool_id: id, lamports: int('lamports') }));
    out({ signature: sig, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'buy') {
    const buyer = keypair(), payer = opt['fee-payer'] ? file(opt['fee-payer']) : buyer, id = int('pool');
    const orderId = Uint8Array.from(Buffer.from(crypto.randomUUID().replace(/-/g, ''), 'hex'));
    const sig = await send(payer, codec.instruction('buy_ticket', {
      buyer: buyer.publicKey, fee_payer: payer.publicKey, config: codec.configPda(), pool: codec.poolPda(id), vault: codec.vaultPda(id), ticket: codec.ticketPda(id, buyer.publicKey),
    }, { pool_id: id, qty: int('qty', 1), order_id: orderId }), payer === buyer ? [] : [buyer]);
    out({ signature: sig, ticket: await account('Ticket', codec.ticketPda(id, buyer.publicKey)) });
  } else if (cmd === 'commit-winners') {
    const who = keypair(), id = int('pool'), w = winnersOf(id);
    const sig = await send(who, codec.instruction('commit_winners', { authority: who.publicKey, config: codec.configPda(), pool: codec.poolPda(id) },
      { pool_id: id, root: Uint8Array.from(w.root), total: w.total, count: w.list.length }));
    out({ signature: sig, root: w.root.toString('base64'), total: w.total, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'veto-winners') {
    const admin = keypair(), id = int('pool');
    const sig = await send(admin, codec.instruction('veto_winners', { authority: admin.publicKey, config: codec.configPda(), pool: codec.poolPda(id) }, { pool_id: id }));
    out({ signature: sig, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'pay-prize') {
    const who = keypair(), id = int('pool'), w = winnersOf(id), rank = int('rank', 1), leaf = w.list[rank - 1] ?? die(`no rank ${rank} in --winners`);
    const sig = await send(who, codec.instruction('pay_prize', { caller: who.publicKey, config: codec.configPda(), pool: codec.poolPda(id), vault: codec.vaultPda(id), to: new PublicKey(leaf.wallet).toBase58() },
      { pool_id: id, rank: rank - 1, lamports: Number(leaf.lamports), proof: w.proofs[rank - 1].map(p => Uint8Array.from(p)) }));
    out({ signature: sig, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'record-ride-attestation') {
    const who = keypair(), id = int('pool'), driver = pk('driver'), rideId = rideIdOf();
    const status = { unverified: 0, verified: 1, flagged: 2 }[opt.status ?? 'verified'] ?? die('--status verified|flagged|unverified');
    const root = opt.root ? Buffer.from(opt.root, 'hex') : status === 1 ? crypto.createHash('sha256').update(`attestation:${id}:${opt.ride}`).digest() : Buffer.alloc(32);
    if (root.length !== 32) die('--root is 32 bytes of hex');
    const att = codec.rideAttestationPda(id, rideId);
    const sig = await send(who, codec.instruction('record_ride_attestation', { authority: who.publicKey, config: codec.configPda(), pool: codec.poolPda(id), ride_attestation: att },
      { pool_id: id, ride_id: rideId, driver, telemetry_root: Uint8Array.from(root), verified_km: int('km', status === 1 ? undefined : 0), status }));
    out({ signature: sig, attestation: await account('RideAttestation', att) });
  } else if (cmd === 'close-ride-attestation') {
    const who = keypair(), id = int('pool'), rideId = rideIdOf(), att = codec.rideAttestationPda(id, rideId);
    const a = await account('RideAttestation', att); if (!a) die(`no ride attestation for ${opt.ride} in pool ${id}`);
    const sig = await send(who, codec.instruction('close_ride_attestation', { caller: who.publicKey, pool: codec.poolPda(id), ride_attestation: att, rent_payer: a.rentPayer }, { pool_id: id, ride_id: rideId }));
    out({ signature: sig, rentTo: a.rentPayer });
  } else if (cmd === 'close-attestation') {
    const who = keypair(), id = int('pool'), driver = pk('driver'), c = await config();
    const sig = await send(who, codec.instruction('close_attestation', { caller: who.publicKey, config: codec.configPda(), pool: codec.poolPda(id), attestation: codec.attestationPda(id, driver),
      rent_to: c.payoutAuthority ?? c.authority }, { pool_id: id, driver }));
    out({ signature: sig, rentTo: c.payoutAuthority ?? c.authority });
  } else if (cmd === 'refund-sponsor' || cmd === 'close-sponsor-receipt') {
    const who = keypair(), id = int('pool'), sponsor = pk('sponsor'), receipt = codec.sponsorReceiptPda(id, sponsor);
    const accounts = cmd === 'refund-sponsor'
      ? { caller: who.publicKey, pool: codec.poolPda(id), vault: codec.vaultPda(id), receipt, sponsor }
      : { caller: who.publicKey, pool: codec.poolPda(id), receipt, sponsor };
    const sig = await send(who, codec.instruction(cmd.replace(/-/g, '_'), accounts, { pool_id: id }));
    out({ signature: sig, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'create-pledge' || cmd === 'settle-pledge' || cmd === 'refund-pledge') {
    const who = keypair(), id = int('pool'), driver = pk('driver');
    const rideId = rideIdOf();
    const sponsor = cmd === 'create-pledge' ? who.publicKey : pk('sponsor'), pledge = codec.pledgePda(rideId, sponsor);
    const ix = cmd === 'create-pledge'
      ? codec.instruction('create_pledge', { sponsor, driver, config: codec.configPda(), pool: codec.poolPda(id), pledge },
        { ride_id: rideId, driver, max_lamports: BigInt(int('per-km')) * BigInt(int('km')), lamports_per_km: int('per-km'), target_km: int('km') })
      : codec.instruction(cmd.replace('-', '_'), cmd === 'settle-pledge'
        ? { caller: who.publicKey, driver, sponsor, config: codec.configPda(), pool: codec.poolPda(id), ride_attestation: codec.rideAttestationPda(id, rideId), pledge }
        : { caller: who.publicKey, sponsor, pool: codec.poolPda(id), ride_attestation: codec.rideAttestationPda(id, rideId), pledge }, { ride_id: rideId });
    const sig = await send(who, ix);
    out({ signature: sig, pledge: pledge.toBase58(), account: await account('Pledge', pledge) });
  } else if (cmd === 'fail-pool' || cmd === 'expire-pool') {
    const who = keypair(), id = int('pool');
    const sig = await send(who, codec.instruction(cmd.replace('-', '_'), { caller: who.publicKey, pool: codec.poolPda(id) }, { pool_id: id }));
    out({ signature: sig, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'refund' || cmd === 'close-ticket') {
    const who = keypair(), id = int('pool'), buyer = pk('buyer'), ticket = codec.ticketPda(id, buyer);
    const t = await account('Ticket', ticket);   // --rent-payer: send it for a ticket that is gone already (tests: the program answers AlreadyRefunded)
    const rentPayer = t?.rentPayer ?? (opt['rent-payer'] ? pk('rent-payer') : die(`no Ticket of ${buyer} in pool ${id} (refunded or closed already?)`));
    const accounts = cmd === 'refund'
      ? { caller: who.publicKey, pool: codec.poolPda(id), vault: codec.vaultPda(id), ticket, buyer, rent_payer: rentPayer }
      : { caller: who.publicKey, pool: codec.poolPda(id), ticket, rent_payer: rentPayer };
    const sig = await send(who, codec.instruction(cmd.replace('-', '_'), accounts, { pool_id: id }));
    out({ signature: sig, buyer, rentPayer, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'cancel-pool') {
    const admin = keypair(), id = int('pool');
    const sig = await send(admin, codec.instruction('cancel_pool', { authority: admin.publicKey, config: codec.configPda(), pool: codec.poolPda(id) }, { pool_id: id }));
    out({ signature: sig, pool: await account('Pool', codec.poolPda(id)) });
  } else if (cmd === 'propose-authority') {
    const admin = keypair();
    const sig = await send(admin, codec.instruction('propose_authority', { authority: admin.publicKey, config: codec.configPda() }, { new_authority: pk('new') }));
    out({ signature: sig, config: await config() });
  } else if (cmd === 'accept-authority') {
    const next = keypair();
    const sig = await send(next, codec.instruction('accept_authority', { new_authority: next.publicKey, config: codec.configPda() }, {}));
    out({ signature: sig, config: await config() });
  } else die(`unknown command ${cmd}`);
} catch (e) {
  const logs = e?.transactionLogs ?? e?.logs;
  die(`${e?.message ?? e}${logs ? `\n  ${logs.join('\n  ')}` : ''}`);
}
