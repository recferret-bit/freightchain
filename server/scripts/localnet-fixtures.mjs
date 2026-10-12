// Phase 1 of the localnet e2e (.claude/skills/localnet-e2e/run.sh): runs the REAL program on a short-lived validator to make pools that are
// "three weeks old", then dumps their accounts for the phase-2 validator (`solana-test-validator --account`). The validator's clock cannot be warped,
// so only three fields are edited after the program wrote everything else: each baked pool's prep_deadline, play_deadline and payout_at (v2: the
// review window's end – the grace and expire_pool count from it), moved 16 days into the past (beyond SETTLE_GRACE_SECS). Also checks initialize for
// real (a stranger is refused, the upgrade authority names the admin).
// THE DAY (phase 3 of run.sh): the admin writes the 1h SERIES here with the real set_series (play / review windows in seconds, the sale window at the
// program's minimum of an hour); its account is dumped into OUT/day/ with ONLY sale_secs shortened (DAY_SALE, default 120 s – the cadence) – the same
// time compression as the deadlines above. `RETIME=1 OUT=… LEAD=<s>` (run.sh, right before the phase-3 validator starts) then moves its next_open_at to
// now + LEAD, so the first slot opens once that validator, its server and the scenario are up.
//   env: RPC, KEYS (scratch keypair dir: upgrader, admin, fee, seed, plat), OUT (dir for the account JSON files + fixtures.json), COVERAGE (file,
//   scripts/localnet-coverage.mjs – this validator is torn down after phase 1, so its ledger is scanned here)
// Baked: pool 0 "EXPIRE" (active, 2 buyers – each pays its own rent, no prize paid) → expire_pool + refunds by the crank;
//        pool 1 "GRACE"  (active, 1 buyer, one prize paid) → anyone may close it after the grace; Config (pool_count = 2, admin, platform 500 bps).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { coverage } from './localnet-coverage.mjs';
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
const admin = args => JSON.parse(execFileSync('node', ['scripts/pool-admin.mjs', ...args, '--url', RPC], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop());
const fails = []; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} [fixtures] ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const newKey = async (name, sol) => {
  const kp = Keypair.generate(); writeFileSync(`${KEYS}/${name}.json`, JSON.stringify([...kp.secretKey]));
  if (sol) await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, sol * 1e9), 'confirmed');
  return `${KEYS}/${name}.json`;
};

// initialize: a stranger first (refused), then the upgrade authority naming the admin
const stranger = await newKey('stranger', 2);
let refused = false;
const cov = process.env.COVERAGE ? coverage(process.env.COVERAGE) : null;
try { admin(['initialize', '-k', stranger, '--admin', pub('stranger'), '--platform-treasury', pub('plat'), '--platform-fee-bps', '500']); } catch (e) { refused = /Unauthorized|0x1771/.test(String(e.stderr)); cov?.refused('initialize by a stranger (not the upgrade authority)', e); }
check('initialize by a stranger is refused (Unauthorized: not the upgrade authority)', refused);
const init = admin(['initialize', '-k', `${KEYS}/upgrader.json`, '--admin', pub('admin'), '--platform-treasury', pub('plat'), '--platform-fee-bps', '500']);
check('initialize by the upgrade authority names the admin (not itself)', init.config.authority === pub('admin') && init.config.authority !== pub('upgrader'));

// two pools that go live at once and whose play window ends in ~8 s
const treas = ['--fee-treasury', pub('fee'), '--seed-treasury', pub('seed'), '-k', `${KEYS}/admin.json`];
// buyers funded first: the buys must land before the (short) prep deadline
const e1 = await newKey('expire-buyer-1', 2), e2 = await newKey('expire-buyer-2', 2), g1 = await newKey('grace-buyer', 2);
const mk = (tier, min) => admin(['create-pool', '--tier', tier, '--price', '50000000', '--min', String(min), '--max', '0', '--per-wallet', '3', '--prep', '+15', '--play', '+17', '--split', '7000/2000/1000', ...treas]).poolId;
const X = mk('8h', 2), Y = mk('8h', 1);
admin(['buy', '-k', e1, '--pool', String(X)]);                                            // pays its own Ticket rent
admin(['buy', '-k', e2, '--pool', String(X)]);                                            // pays its own Ticket rent too
admin(['buy', '-k', g1, '--pool', String(Y)]);
const now = async () => Number((await conn.getAccountInfo(new PublicKey('SysvarC1ock11111111111111111111111111111111'))).data.readBigInt64LE(32));
const play = Number(codec.decodeAccount('Pool', (await conn.getAccountInfo(codec.poolPda(Y))).data).playDeadline.getTime() / 1000);
while ((await now()) < play + 1) await sleep(1000);
admin(['record-attestation', '-k', `${KEYS}/admin.json`, '--pool', String(Y), '--driver', pub('grace-buyer'), '--km', '3']);   // v3: no prize without the winner's VERIFIED attestation
admin(['pay-prize', '-k', `${KEYS}/admin.json`, '--pool', String(Y), '--to', pub('grace-buyer'), '--lamports', '10000000']);

// dump: Config, both pools, their vaults, the three tickets; edit only the deadlines (16 days back), verify by decoding
const PREP = 63, PLAY = 71, PAYOUT = 79;   // Pool: disc 8 | pool_id u32 | authority 32 | tier u8 | price u64 | min u32 | max u32 | max_per_wallet u16 | prep i64 | play i64 | payout_at i64
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
for (const d of dumps.filter(x => /^pool-(expire|grace)$/.test(x.label))) {
  const p = codec.decodeAccount('Pool', d.data);
  check(`${d.label}: decodes after the edit, sale / play / review ends ${new Date(back * 1000).toISOString().slice(0, 10)}, still active`, p && p.status === 1 && [p.prepDeadline, p.playDeadline, p.payoutAt].every(t => t.getTime() === back * 1000), JSON.stringify({ status: p?.status, play: p?.playDeadline, payoutAt: p?.payoutAt }));
}
const cfg = codec.decodeAccount('Config', dumps[0].data);
writeFileSync(`${OUT}/fixtures.json`, JSON.stringify({ expirePool: X, gracePool: Y, poolCount: cfg.poolCount, prizePaid: 10_000_000, back, accounts: dumps.map(d => d.file) }));
check('Config baked with pool_count = 2 (new pools get ids 2, 3, …)', cfg.poolCount === 2);

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
  writeFileSync(`${OUT}/day/series-1h.json`, JSON.stringify({ pubkey: codec.seriesPda(1).toBase58(), account: { lamports: a.lamports, data: [data.toString('base64'), 'base64'], owner: a.owner.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
  writeFileSync(`${OUT}/day/day.json`, JSON.stringify({ tier: '1h', saleSecs: DAY_SALE, playSecs: DAY_PLAY, reviewSecs: DAY_REVIEW, minTickets: 4, maxPerWallet: 2, price: 100_000_000, split: [7000, 2000, 1000] }));
}
if (cov) { const sc = await cov.scan(conn, 'phase 1 (fixtures validator)'); console.log(`coverage: ${sc.transactions} program transactions on the fixtures validator`); }
process.exit(fails.length ? 1 : 0);
