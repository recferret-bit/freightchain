// Phase 1 of the localnet e2e (.claude/skills/localnet-e2e/run.sh): runs the REAL program on a short-lived validator to make pools that are
// "three weeks old", then dumps their accounts for the phase-2 validator (`solana-test-validator --account`). The validator's clock cannot be warped,
// so only two fields are edited after the program wrote everything else: each baked pool's prep_deadline and play_deadline, moved 16 days into the
// past (beyond SETTLE_GRACE_SECS). Also checks initialize for real (a stranger is refused, the upgrade authority names the admin).
//   env: RPC, KEYS (scratch keypair dir: upgrader, admin, sponsor, fee, seed, plat), OUT (dir for the account JSON files + fixtures.json)
// Baked: pool 0 "EXPIRE" (active, 2 buyers – one self-paid rent, one sponsor-paid rent, no prize paid) → expire_pool + refunds by the crank;
//        pool 1 "GRACE"  (active, 1 buyer, one prize paid) → anyone may close it after the grace; Config (pool_count = 2, admin, platform 500 bps).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { POOL_PROGRAM_IDL } from '../dist/infrastructure/solana/pool-program.idl.js';

const { RPC, KEYS, OUT } = process.env;
if (!RPC || !KEYS || !OUT) { console.error('needs RPC, KEYS, OUT (run through .claude/skills/localnet-e2e/run.sh)'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const conn = new Connection(RPC, 'confirmed');
const codec = new PoolProgramCodec(POOL_PROGRAM_IDL.address);
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
try { admin(['initialize', '-k', stranger, '--admin', pub('stranger'), '--platform-treasury', pub('plat'), '--platform-fee-bps', '500']); } catch (e) { refused = /Unauthorized|0x1771/.test(String(e.stderr)); }
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
admin(['buy', '-k', e2, '--fee-payer', `${KEYS}/sponsor.json`, '--pool', String(X)]);   // the sponsor pays the rent (gasless)
admin(['buy', '-k', g1, '--pool', String(Y)]);
const now = async () => Number((await conn.getAccountInfo(new PublicKey('SysvarC1ock11111111111111111111111111111111'))).data.readBigInt64LE(32));
const play = Number(codec.decodeAccount('Pool', (await conn.getAccountInfo(codec.poolPda(Y))).data).playDeadline.getTime() / 1000);
while ((await now()) < play + 1) await sleep(1000);
admin(['pay-prize', '-k', `${KEYS}/admin.json`, '--pool', String(Y), '--to', pub('grace-buyer'), '--lamports', '10000000']);

// dump: Config, both pools, their vaults, the three tickets; edit only the deadlines (16 days back), verify by decoding
const PREP = 63, PLAY = 71;   // Pool: disc 8 | pool_id u32 | authority 32 | tier u8 | price u64 | min u32 | max u32 | max_per_wallet u16 | prep i64 | play i64
const back = Math.floor(Date.now() / 1000) - 16 * 86_400;
const dumps = [];
const dump = async (label, address, edit) => {
  const a = await conn.getAccountInfo(address, 'confirmed');
  const data = Buffer.from(a.data); if (edit) edit(data);
  const file = `${OUT}/${label}.json`;
  writeFileSync(file, JSON.stringify({ pubkey: address.toBase58(), account: { lamports: a.lamports, data: [data.toString('base64'), 'base64'], owner: a.owner.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
  dumps.push({ label, address: address.toBase58(), file, data });
};
const pastDeadlines = d => { d.writeBigInt64LE(BigInt(back), PREP); d.writeBigInt64LE(BigInt(back), PLAY); };
await dump('config', codec.configPda());
for (const [label, id] of [['pool-expire', X], ['pool-grace', Y]]) { await dump(label, codec.poolPda(id), pastDeadlines); await dump(`${label}-vault`, codec.vaultPda(id)); }
for (const [label, id, buyer] of [['ticket-e1', X, 'expire-buyer-1'], ['ticket-e2', X, 'expire-buyer-2'], ['ticket-g1', Y, 'grace-buyer']]) await dump(label, codec.ticketPda(id, pub(buyer)));
for (const d of dumps.filter(x => /^pool-(expire|grace)$/.test(x.label))) {
  const p = codec.decodeAccount('Pool', d.data);
  check(`${d.label}: decodes after the edit, deadlines ${new Date(back * 1000).toISOString().slice(0, 10)}, still active`, p && p.status === 1 && p.prepDeadline.getTime() === back * 1000 && p.playDeadline.getTime() === back * 1000, JSON.stringify({ status: p?.status, play: p?.playDeadline }));
}
const cfg = codec.decodeAccount('Config', dumps[0].data);
writeFileSync(`${OUT}/fixtures.json`, JSON.stringify({ expirePool: X, gracePool: Y, poolCount: cfg.poolCount, prizePaid: 10_000_000, back, accounts: dumps.map(d => d.file) }));
check('Config baked with pool_count = 2 (new pools get ids 2, 3, …)', cfg.poolCount === 2);
process.exit(fails.length ? 1 : 0);
