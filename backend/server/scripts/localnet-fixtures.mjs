// Phase 1 of the localnet e2e (.claude/skills/localnet-e2e/run.sh): runs the REAL program on a short-lived validator to make pools that are
// "three weeks old", then dumps their accounts for the phase-2 validator (`solana-test-validator --account`). The validator's clock cannot be warped,
// so a few bytes are edited after the program wrote everything else: (1) each baked pool's prep_deadline, play_deadline and payout_at (v2: the review
// window's end – the grace and expire_pool count from it), moved 16 days into the past (beyond SETTLE_GRACE_SECS); (2) pool REARM's created_at, moved 30
// days ahead so the crank (which seals a pool 8 s after its creation) leaves it unsealed until its seal slot has left the SlotHashes window (SealRearmed);
// (3) the Config, dumped in the v3 LAYOUT (the v4 floors cut off) so phase 2 runs the real migrate_config_v4 (`MIGRATE=1`, before the server starts);
// (4) one account written whole: the v3 per-driver Attestation the GRACE pool's winner would hold after a v3 deployment (close_attestation reclaims it –
// v4 has no instruction that creates one). Also checks initialize for real (a stranger is refused, the upgrade authority names the admin) and lowers the
// v4 floors to 0 (set_config) – the localnet pools are seconds wide.
// THE DAY (phase 3 of run.sh): the admin writes the 1h SERIES here with the real set_series (play / review windows in seconds, the sale window at the
// program's minimum of an hour); its account is dumped into OUT/day/ with ONLY sale_secs shortened (DAY_SALE, default 120 s – the cadence) – the same
// time compression as the deadlines above. `RETIME=1 OUT=… LEAD=<s>` (run.sh, right before the phase-3 validator starts) then moves its next_open_at to
// now + LEAD, so the first slot opens once that validator, its server and the scenario are up.
//   env: RPC, KEYS (scratch keypair dir: upgrader, admin, fee, seed, plat), OUT (dir for the account JSON files + fixtures.json), COVERAGE (file,
//   scripts/localnet-coverage.mjs – this validator is torn down after phase 1, so its ledger is scanned here)
// Baked: pool 0 "EXPIRE" (active, 2 buyers – each pays its own rent, no prize paid) → expire_pool + refunds by the crank;
//        pool 1 "GRACE"  (active, 1 buyer, one prize paid from a committed winners root) → anyone may close it after the grace; its winner's v3 Attestation;
//        pool 2 "REARM"  (open, never sealed) → the payout scenario's seal_road re-arms it, then seals it;
//        Config (v3 layout, pool_count = 3, admin, platform 500 bps).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'; import crypto from 'node:crypto'; import { execFileSync } from 'node:child_process';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { coverage } from './localnet-coverage.mjs';
import { sealRoad } from './localnet-seal.mjs';
import { POOL_PROGRAM_IDL } from '../dist/infrastructure/solana/pool-program.idl.js';

const { RPC, KEYS, OUT } = process.env;
const codec = new PoolProgramCodec(POOL_PROGRAM_IDL.address);
// Series: disc 8 | tier u8 | enabled bool | price u64 | min u32 | max u32 | max_per_wallet u16 | sale_secs i64 @28 | play_secs i64 @36 | verify_secs i64 @44 |
//         bps u16 ×3 | fee 32 | seed 32 | next_open_at i64 @122 | pools_opened u32 | last_pool_id Option<u32> | bump
const SALE_SECS = 28, NEXT_OPEN_AT = 122;
const secs = v => (v instanceof Date ? v.getTime() : Date.parse(v)) / 1000;   // the codec turns every i64 into a Date (pool-admin prints it as ISO), durations too
if (process.env.RETIME) {   // phase 3: the series' first slot = now + LEAD (the account file is edited in place, then decoded to prove it)
  const file = `${OUT}/day/series-1h.json`, j = JSON.parse(readFileSync(file, 'utf8'));
  const data = Buffer.from(j.account.data[0], 'base64'), at = Math.floor(Date.now() / 1000) + Number(process.env.LEAD || 75);
  data.writeBigInt64LE(BigInt(at), NEXT_OPEN_AT); j.account.data[0] = data.toString('base64'); writeFileSync(file, JSON.stringify(j));
  const sr = codec.decodeAccount('Series', data);
  if (!sr || sr.nextOpenAt.getTime() !== at * 1000) { console.error('series retime did not decode back'); process.exit(1); }
  console.log(`  series 1h: next_open_at = ${new Date(at * 1000).toISOString()} (in ${process.env.LEAD || 75} s), slot ${secs(sr.saleSecs)} s, play ${secs(sr.playSecs)} s, review ${secs(sr.verifySecs)} s`);
  process.exit(0);
}
if (!RPC || !KEYS || !OUT) { console.error('needs RPC, KEYS, OUT (run through .claude/skills/localnet-e2e/run.sh)'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const conn = new Connection(RPC, 'confirmed');
const pub = n => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${KEYS}/${n}.json`, 'utf8')))).publicKey.toBase58();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const V3_CONFIG_LEN = 8 + 32 + 32 + 2 + 4 + 1 + 1 + 33 + 33;   // the v3 Config's account size (state.rs before the two v4 floors)
const admin = args => JSON.parse(execFileSync('node', ['scripts/pool-admin.mjs', ...args, '--url', RPC], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop());
const fails = []; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} [fixtures] ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const newKey = async (name, sol) => {
  const kp = Keypair.generate(); writeFileSync(`${KEYS}/${name}.json`, JSON.stringify([...kp.secretKey]));
  if (sol) await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, sol * 1e9), 'confirmed');
  return `${KEYS}/${name}.json`;
};

// MIGRATE=1 (run.sh, phase 2, before the server starts): the baked Config is in the v3 LAYOUT (the dump below) – the program's own migration, for real
if (process.env.MIGRATE) {
  const cov = process.env.COVERAGE ? coverage(process.env.COVERAGE) : null;
  const refuse = (step, args, want) => { try { admin(args); return check(`${step} → refused ${want}`, false, 'it LANDED'); } catch (e) { const got = cov?.refused(step, e) ?? null; return check(`${step} → refused ${want}`, got === want, got ?? String(e.stderr ?? e).split('\n').slice(0, 2).join(' ')); } };
  await conn.confirmTransaction(await conn.requestAirdrop(new PublicKey(pub('stranger')), 1e9), 'confirmed');
  const info0 = await conn.getAccountInfo(codec.configPda(), 'confirmed'), adminKey = `${KEYS}/admin.json`;
  check(`phase 2 starts from a v3-layout Config (${info0.data.length} bytes, no floors) – as a v3 deployment leaves it`, info0.data.length === V3_CONFIG_LEN);
  refuse('set_config of a floor on a v3 Config', ['set-config', '--min-review-secs', '0', '-k', adminKey], 'ConfigNotMigrated');
  refuse('migrate_config_v4 by a stranger (not the Config\'s authority)', ['migrate-config', '-k', `${KEYS}/stranger.json`], 'Unauthorized');
  const a0 = await conn.getBalance(new PublicKey(pub('admin')), 'confirmed');
  const m = admin(['migrate-config', '-k', adminKey]);
  const info1 = await conn.getAccountInfo(codec.configPda(), 'confirmed'), c = codec.decodeAccount('Config', info1.data);
  const fee = (await conn.getTransaction(m.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })).meta.fee;
  const topUp = (await conn.getMinimumBalanceForRentExemption(info1.data.length)) - info0.lamports;
  check('migrate_config_v4 by the admin: the Config grows to the v4 layout, every v3 field kept, the floors at their defaults (3600 / 10 800 s), the admin paid the extra rent + its fee',
    info1.data.length > V3_CONFIG_LEN && c.authority === pub('admin') && c.platformTreasury === pub('plat') && c.platformFeeBps === 500 && c.poolCount === 3 && c.paused === false && c.payoutAuthority === null
    && secs(c.minReviewSecs) === 3600 && secs(c.minFinishSecs) === 10_800 && a0 - (await conn.getBalance(new PublicKey(pub('admin')), 'confirmed')) === topUp + fee && topUp > 0, JSON.stringify({ len: info1.data.length, c, topUp }));
  refuse('migrate_config_v4 of a Config already migrated', ['migrate-config', '-k', adminKey], 'AlreadyMigrated');
  refuse('create_pool with a 60 s play window under the default floors', ['create-pool', '--tier', '8h', '--price', '50000000', '--min', '1', '--prep', '+60', '--play', '+120', '--fee-treasury', pub('fee'), '--seed-treasury', pub('seed'), '-k', adminKey], 'WindowTooShort');
  const fl = admin(['set-config', '--min-review-secs', '0', '--min-finish-secs', '0', '-k', adminKey]).config;
  check('set_config: the floors lowered to 0 again for the seconds-wide localnet pools', secs(fl.minReviewSecs) === 0 && secs(fl.minFinishSecs) === 0);
  process.exit(fails.length ? 1 : 0);
}
// initialize: a stranger first (refused), then the upgrade authority naming the admin
const stranger = await newKey('stranger', 2);
let refused = false;
const cov = process.env.COVERAGE ? coverage(process.env.COVERAGE) : null;
try { admin(['initialize', '-k', stranger, '--admin', pub('stranger'), '--platform-treasury', pub('plat'), '--platform-fee-bps', '500']); } catch (e) { refused = /Unauthorized|0x1771/.test(String(e.stderr)); cov?.refused('initialize by a stranger (not the upgrade authority)', e); }
check('initialize by a stranger is refused (Unauthorized: not the upgrade authority)', refused);
const init = admin(['initialize', '-k', `${KEYS}/upgrader.json`, '--admin', pub('admin'), '--platform-treasury', pub('plat'), '--platform-fee-bps', '500']);
check('initialize by the upgrade authority names the admin (not itself)', init.config.authority === pub('admin') && init.config.authority !== pub('upgrader'));
// v4: initialize sets the floors (a 1 h review window, 3 h to finish after the sale) – the localnet pools are seconds wide, so the admin lowers them to 0
const floors = admin(['set-config', '--min-review-secs', '0', '--min-finish-secs', '0', '-k', `${KEYS}/admin.json`]).config;
check('set_config by the admin: the v4 floors (3600 / 10800 s after initialize) lowered to 0 for the seconds-wide localnet pools', secs(floors.minReviewSecs) === 0 && secs(floors.minFinishSecs) === 0, JSON.stringify({ review: floors.minReviewSecs, finish: floors.minFinishSecs }));

// two pools that go live at once and whose play window ends in ~8 s
const treas = ['--fee-treasury', pub('fee'), '--seed-treasury', pub('seed'), '-k', `${KEYS}/admin.json`];
// buyers funded first: the buys must land before the (short) prep deadline
const e1 = await newKey('expire-buyer-1', 2), e2 = await newKey('expire-buyer-2', 2), g1 = await newKey('grace-buyer', 2);
const mk = (tier, min) => admin(['create-pool', '--tier', tier, '--price', '50000000', '--min', String(min), '--max', '0', '--per-wallet', '3', '--prep', '+25', '--play', '+27', '--split', '7000/2000/1000', ...treas]).poolId;
const X = mk('8h', 2), Y = mk('8h', 1);
admin(['buy', '-k', e1, '--pool', String(X)]);                                            // pays its own Ticket rent
admin(['buy', '-k', e2, '--pool', String(X)]);                                            // pays its own Ticket rent too
admin(['buy', '-k', g1, '--pool', String(Y)]);
admin(['sponsor', '-k', g1, '--pool', String(Y), '--lamports', '60000000']);              // v5: covers Y's ticket under the 47.4 % player-share cap
// v4 (L4): both roads sealed from a slot after the pools opened (the crank's job on a server) – an unsealed baked pool would make phase 2's crank seal it first
const codecConn = { conn, codec, admintool: admin, keyfile: stranger };
for (const id of [X, Y]) await sealRoad({ ...codecConn, id });
check('seal_road: both baked pools sealed (seed commitment from a later slot, seal_slot 0)', (await Promise.all([X, Y].map(async id => { const p = codec.decodeAccount('Pool', (await conn.getAccountInfo(codec.poolPda(id), 'confirmed')).data); return Number(p.sealSlot) === 0 && !/^A+=*$/.test(p.seedCommitment); }))).every(Boolean));
const now = async () => Number((await conn.getAccountInfo(new PublicKey('SysvarC1ock11111111111111111111111111111111'))).data.readBigInt64LE(32));
const play = Number(codec.decodeAccount('Pool', (await conn.getAccountInfo(codec.poolPda(Y))).data).playDeadline.getTime() / 1000);
while ((await now()) < play + 1) await sleep(1000);
// v4 (H5-B): the prize is paid from a committed winners root (one rank) – with the floors at 0 and payout_at = play, it pays from the commit on
const winners = `${pub('grace-buyer')}:10000000`;
admin(['commit-winners', '-k', `${KEYS}/admin.json`, '--pool', String(Y), '--winners', winners]);
admin(['pay-prize', '-k', stranger, '--pool', String(Y), '--winners', winners, '--rank', '1']);   // permissionless: the root decides who gets what
// pool 2 "REARM": opened and NEVER sealed – in phase 2 its seal slot has long left the 512-slot SlotHashes window, so the first seal_road re-arms it
// (SealRearmed). Its created_at is moved 30 days ahead in the dump: the crank seals a pool only 8 s after it was created, so it leaves this one alone.
const RA = admin(['create-pool', '--tier', '8h', '--price', '50000000', '--min', '1', '--max', '0', '--per-wallet', '1', '--prep', '+86400', '--play', '+86460', '--split', '7000/2000/1000', ...treas]).poolId;

// dump: Config, both pools, their vaults, the three tickets; edit only the deadlines (16 days back), verify by decoding
const PREP = 63, PLAY = 71, PAYOUT = 79, CREATED_AT = 190;   // … status u8 @157 | tickets_sold | buyers | sponsored | prizes_paid | refunded | created_at i64 @190   // Pool: disc 8 | pool_id u32 | authority 32 | tier u8 | price u64 | min u32 | max u32 | max_per_wallet u16 | prep i64 | play i64 | payout_at i64
const back = Math.floor(Date.now() / 1000) - 16 * 86_400;
const dumps = [];
const dump = async (label, address, edit) => {
  const a = await conn.getAccountInfo(address, 'confirmed');
  const data = Buffer.from(a.data); if (edit) edit(data);
  const file = `${OUT}/${label}.json`;
  writeFileSync(file, JSON.stringify({ pubkey: address.toBase58(), account: { lamports: a.lamports, data: [data.toString('base64'), 'base64'], owner: a.owner.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
  dumps.push({ label, address: address.toBase58(), file, data });
};
const pastDeadlines = d => { for (const at of [PREP, PLAY, PAYOUT]) d.writeBigInt64LE(BigInt(back), at); };
await dump('config', codec.configPda());
for (const [label, id] of [['pool-expire', X], ['pool-grace', Y]]) { await dump(label, codec.poolPda(id), pastDeadlines); await dump(`${label}-vault`, codec.vaultPda(id)); }
for (const [label, id, buyer] of [['ticket-e1', X, 'expire-buyer-1'], ['ticket-e2', X, 'expire-buyer-2'], ['ticket-g1', Y, 'grace-buyer']]) await dump(label, codec.ticketPda(id, pub(buyer)));
const rearmAt = Math.floor(Date.now() / 1000) + 30 * 86_400;
await dump('pool-rearm', codec.poolPda(RA), d => d.writeBigInt64LE(BigInt(rearmAt), CREATED_AT)); await dump('pool-rearm-vault', codec.vaultPda(RA));
{
  const p = codec.decodeAccount('Pool', dumps.find(x => x.label === 'pool-rearm').data);
  check(`pool-rearm: decodes after the edit, open, unsealed (seal slot ${p?.sealSlot}), created_at 30 days ahead`, p && p.status === 0 && Number(p.sealSlot) > 0 && p.createdAt.getTime() === rearmAt * 1000, JSON.stringify({ status: p?.status, seal: p?.sealSlot, created: p?.createdAt }));
}
// the Config in the v3 LAYOUT (v4 = the same borsh fields + two i64 floors at the end): both Options are None here, so the v3 bytes are the first 82,
// zero-padded to the v3 size – phase 2 migrates it with the real migrate_config_v4 (run.sh, MIGRATE=1) before the server starts
const cfgV4 = dumps[0].data;
if (cfgV4[80] !== 0 || cfgV4[81] !== 0) { console.error('the phase-1 Config has a pending / payout authority – the v3 layout below assumes None'); process.exit(1); }
{
  const v3 = Buffer.alloc(V3_CONFIG_LEN); cfgV4.copy(v3, 0, 0, 82);
  const j = JSON.parse(readFileSync(dumps[0].file, 'utf8'));
  j.account.data[0] = v3.toString('base64'); j.account.space = v3.length; j.account.lamports = await conn.getMinimumBalanceForRentExemption(v3.length);
  writeFileSync(dumps[0].file, JSON.stringify(j));
}
// a v3 per-driver Attestation of the GRACE pool's winner – what a v3 deployment left for every paid winner (record_attestation is gone in v4, so it is written
// here byte for byte: disc | pool | driver | telemetry_root | verified_km u32 | status u8 | recorded_at i64 | bump); close_attestation reclaims it once the pool is settled
{
  const pool = codec.poolPda(Y), driver = new PublicKey(pub('grace-buyer'));
  const [address, bump] = PublicKey.findProgramAddressSync([Buffer.from('attestation'), pool.toBuffer(), driver.toBuffer()], codec.programId);
  if (!address.equals(codec.attestationPda(Y, driver.toBase58()))) { console.error('v3 attestation PDA mismatch'); process.exit(1); }
  const disc = POOL_PROGRAM_IDL.accounts.find(a => a.name === 'Attestation').discriminator;
  const data = Buffer.alloc(8 + 32 + 32 + 32 + 4 + 1 + 8 + 1);
  let o = 0; Buffer.from(disc).copy(data, o); o += 8; pool.toBuffer().copy(data, o); o += 32; driver.toBuffer().copy(data, o); o += 32;
  crypto.createHash('sha256').update(`v3 attestation ${Y}`).digest().copy(data, o); o += 32; data.writeUInt32LE(3, o); o += 4; data.writeUInt8(1, o); o += 1;
  data.writeBigInt64LE(BigInt(await now()), o); o += 8; data.writeUInt8(bump, o);
  const a = codec.decodeAccount('Attestation', data);
  check('a v3 Attestation of the grace pool\'s winner (VERIFIED, 3 km) – decodes, at its PDA', a?.driver === driver.toBase58() && a.status === 1 && a.verifiedKm === 3 && a.bump === bump, JSON.stringify(a));
  const file = `${OUT}/attestation-v3-grace.json`;
  writeFileSync(file, JSON.stringify({ pubkey: address.toBase58(), account: { lamports: await conn.getMinimumBalanceForRentExemption(data.length), data: [data.toString('base64'), 'base64'], owner: codec.programId.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
  dumps.push({ label: 'attestation-v3-grace', address: address.toBase58(), file, data });
}
for (const d of dumps.filter(x => /^pool-(expire|grace)$/.test(x.label))) {
  const p = codec.decodeAccount('Pool', d.data);
  check(`${d.label}: decodes after the edit, sale / play / review ends ${new Date(back * 1000).toISOString().slice(0, 10)}, still active`, p && p.status === 1 && [p.prepDeadline, p.playDeadline, p.payoutAt].every(t => t.getTime() === back * 1000), JSON.stringify({ status: p?.status, play: p?.playDeadline, payoutAt: p?.payoutAt }));
}
const cfg = codec.decodeAccount('Config', dumps[0].data);
writeFileSync(`${OUT}/fixtures.json`, JSON.stringify({ expirePool: X, gracePool: Y, rearmPool: RA, v3Attestation: { pool: Y, driver: pub('grace-buyer') }, poolCount: cfg.poolCount, prizePaid: 10_000_000, back, accounts: dumps.map(d => d.file) }));
check('Config baked with pool_count = 3 (new pools get ids 3, 4, …), dumped in the v3 layout', cfg.poolCount === 3);

// THE DAY's series (phase 3 only – nothing of it is loaded into phase 2, where it would open pools under the money scenarios): the admin writes the 1h
// series with the real set_series – min 4 tickets, ≤ 2 per wallet, play / review windows in seconds; the program wants a sale window of an hour at least,
// so the DUMP gets only sale_secs shortened (the cadence: the next pool opens when this one stops selling). next_open_at is set at phase 3 (RETIME).
const DAY_SALE = +(process.env.DAY_SALE || 120), DAY_PLAY = +(process.env.DAY_PLAY || 45), DAY_REVIEW = +(process.env.DAY_REVIEW || 45);
const ser = admin(['set-series', '--tier', '1h', '--price', '100000000', '--min', '4', '--max', '0', '--per-wallet', '2', '--split', '7000/2000/1000',
  '--sale-secs', '3600', '--play-secs', String(DAY_PLAY), '--review-secs', String(DAY_REVIEW), '--start', '+3600', ...treas]).series;
check('set_series by the admin: the 1h series is written by the real program (sale window = the program minimum, 3600 s)', ser?.enabled === true && secs(ser.saleSecs) === 3600 && secs(ser.playSecs) === DAY_PLAY && secs(ser.verifySecs) === DAY_REVIEW && ser.poolsOpened === 0, JSON.stringify(ser));
mkdirSync(`${OUT}/day`, { recursive: true });
{
  const a = await conn.getAccountInfo(codec.seriesPda(1), 'confirmed');
  const data = Buffer.from(a.data); data.writeBigInt64LE(BigInt(DAY_SALE), SALE_SECS);
  const sr = codec.decodeAccount('Series', data);
  check(`series dump: decodes after the edit with a ${DAY_SALE} s slot, everything else as the program wrote it`, sr && secs(sr.saleSecs) === DAY_SALE && secs(sr.playSecs) === DAY_PLAY && secs(sr.verifySecs) === DAY_REVIEW && sr.minTickets === 4 && sr.maxPerWallet === 2 && sr.feeTreasury === pub('fee') && sr.seedTreasury === pub('seed') && sr.enabled, JSON.stringify(sr));
  // set_series stores the live Config split. open_next_pool copies that onto the pool; the --split argument is not the pool's split.
  check('series split is the Config snapshot (prize + seed + fee = 10000)', sr.prizeBps + sr.seedBps + sr.feeBps === 10000 && sr.prizeBps === ser.prizeBps, `${sr.prizeBps}/${sr.seedBps}/${sr.feeBps}`);
  writeFileSync(`${OUT}/day/series-1h.json`, JSON.stringify({ pubkey: codec.seriesPda(1).toBase58(), account: { lamports: a.lamports, data: [data.toString('base64'), 'base64'], owner: a.owner.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
  writeFileSync(`${OUT}/day/day.json`, JSON.stringify({ tier: '1h', saleSecs: DAY_SALE, playSecs: DAY_PLAY, reviewSecs: DAY_REVIEW, minTickets: 4, maxPerWallet: 2, price: 100_000_000, split: [sr.prizeBps, sr.seedBps, sr.feeBps] }));
}
if (cov) { const sc = await cov.scan(conn, 'phase 1 (fixtures validator)'); console.log(`coverage: ${sc.transactions} program transactions on the fixtures validator`); }
process.exit(fails.length ? 1 : 0);
