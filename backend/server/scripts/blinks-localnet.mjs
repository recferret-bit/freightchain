// The Blink suite owns its pool, validator, API and database. No seeded/fictitious pool or remote transaction.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, openSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { prepareChain } from '../../../infra/deploy/scripts/local-production-chain.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), server = join(root, 'backend/server');
const build = resolve(server, process.env.SERVER_BUILD || 'dist');
const { PoolProgramCodec } = await import(pathToFileURL(join(build, 'infrastructure/solana/pool-program.codec.js')));
const { POOL_PROGRAM_IDL } = await import(pathToFileURL(join(build, 'infrastructure/solana/pool-program.idl.js')));
const out = mkdtempSync(join(tmpdir(), 'fc-blinks-localnet-')), fixture = {}, result = { output: out, passed: false };
const database = `freightchain_blinks_${process.pid}_test`, url = new URL(process.env.DATABASE_URL || 'postgresql://freight:freight_dev_password@localhost:15433/postgres');
assert(['localhost', '127.0.0.1'].includes(url.hostname), 'test database must be local');
url.pathname = '/postgres'; const adminDb = new PrismaClient({ datasources: { db: { url: url.href } } }); url.pathname = `/${database}`;
const dbUrl = url.href, sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'CHROME', 'CHROME_BIN'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
let chain, app, browser, madeDb = false;
async function stop(child) { if (!child || child.exitCode !== null || child.signalCode) return; child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(5000)]); if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL'); }
const freePort = () => new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app?.kill('SIGTERM'); browser?.kill('SIGTERM'); });
try {
  chain = await prepareChain({ root, out, fixture, result });
  result.chain = 'real scratch native validator; browser wallet and API use loopback RPC';
  const rpc = result.validatorRpc, conn = new Connection(rpc, 'confirmed'), codec = new PoolProgramCodec(POOL_PROGRAM_IDL.address);
  const key = name => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(out, `${name}.json`))))), payer = key('admin');
  async function send(ix) {
    const tx = new Transaction({ feePayer: payer.publicKey, ...await conn.getLatestBlockhash() }).add(ix); tx.sign(payer);
    const signature = await conn.sendRawTransaction(tx.serialize());
    for (let i = 0; i < 120; i++) { const st = (await conn.getSignatureStatuses([signature])).value[0]; assert(!st?.err, JSON.stringify(st?.err)); if (['confirmed', 'finalized'].includes(st?.confirmationStatus)) return; await sleep(250); }
    throw new Error('fixture transaction not confirmed');
  }
  for (const name of ['fee', 'seed']) await send(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: key(name).publicKey, lamports: 1e9 }));
  const programData = PublicKey.findProgramAddressSync([codec.programId.toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0];
  await send(codec.instruction('initialize', { upgrade_authority: payer.publicKey, program: codec.programId, program_data: programData, config: codec.configPda(), platform_treasury_account: key('fee').publicKey }, { authority: payer.publicKey.toBase58(), platform_treasury: key('fee').publicKey.toBase58(), platform_fee_bps: 500 }));
  await send(codec.instruction('set_pool_rules', { authority: payer.publicKey, config: codec.configPda() }, { paid_tickets_enabled: true, prize_bps: 8500, seed_bps: 500, fee_bps: 1000, max_player_share_bps: 4740, max_tickets: 0 }));
  const now = Math.floor(Date.now() / 1000);
  await send(codec.instruction('create_pool', { authority: payer.publicKey, config: codec.configPda(), pool: codec.poolPda(0), vault: codec.vaultPda(0), fee_treasury: key('fee').publicKey, seed_treasury: key('seed').publicKey, platform_treasury: key('fee').publicKey }, { params: { tier: 1, price_lamports: 50000000, min_tickets: 0, max_tickets: 0, max_per_wallet: 5, prep_deadline: now + 3600, play_deadline: now + 18000, payout_at: now + 22000, opens_at: now - 1, last_start_at: now + 13500 } }));
  await send(codec.instruction('sponsor', { sponsor: payer.publicKey, config: codec.configPda(), pool: codec.poolPda(0), vault: codec.vaultPda(0), receipt: codec.sponsorReceiptPda(0, payer.publicKey) }, { pool_id: 0, lamports: 1e9 }));
  const pool = codec.decodeAccount('Pool', (await conn.getAccountInfo(codec.poolPda(0))).data);
  while (await conn.getSlot() <= Number(pool.sealSlot) + 1) await sleep(300);
  await send(codec.instruction('seal_road', { caller: payer.publicKey, pool: codec.poolPda(0) }, { pool_id: 0 }));
  await adminDb.$executeRawUnsafe(`CREATE DATABASE "${database}"`); madeDb = true;
  const envFile = join(out, 'empty.env'); writeFileSync(envFile, '');
  const migrate = spawnSync(join(server, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], { cwd: server, env: { ...safeEnv, ENV_FILE: envFile, DATABASE_URL: dbUrl }, encoding: 'utf8' });
  writeFileSync(join(out, 'migrations.log'), (migrate.stdout || '') + (migrate.stderr || ''), { mode: 0o600 }); assert.equal(migrate.status, 0, 'scratch migrations failed');
  const port = await freePort(), base = `http://localhost:${port}`;
  const env = { ...safeEnv, ENV_FILE: envFile, DATABASE_URL: dbUrl, PORT: String(port), NODE_ENV: 'development', JWT_SECRET: randomBytes(32).toString('hex'), IP_HASH_SECRET: randomBytes(32).toString('hex'), APP_ORIGIN: base, APP_DOMAIN: `localhost:${port}`, SOLANA_RPC: rpc, SNS_RPC: 'http://127.0.0.1:9', PAYMENT_MODE: 'program', TICKET_PROGRAM_ID: POOL_PROGRAM_IDL.address, TREASURY_PUBKEY: key('fee').publicKey.toBase58(), FEE_TREASURY: key('fee').publicKey.toBase58(), SEED_TREASURY: key('seed').publicKey.toBase58(), WATCH_INTERVAL_MS: '500', CRANK_INTERVAL_MS: '0', PAYOUT_INTERVAL_MS: '0', SOL_USD: '118', PRIZE_DEV_DEFAULT_COUNTRY: 'KP', POSTHOG_ENABLED: '0', LIVE_EFFECTS: 'off', CLIENT_DIR: process.env.CLIENT_DIR || join(root, 'frontend/client'), LANDING_DIR: process.env.LANDING_DIR || join(root, 'frontend/landing/dist') };
  const log = openSync(join(out, 'server.log'), 'a', 0o600);
  async function startApi() {
    app = spawn(process.execPath, [join(build, 'main.js')], { cwd: server, env, stdio: ['ignore', log, log] });
    let ready = false;
    for (let i = 0; i < 90; i++) { assert.equal(app.exitCode, null, 'scratch API exited'); try { const r = await fetch(`${base}/api/pools/0`); if (r.ok) { ready = true; break; } } catch {} await sleep(500); }
    assert(ready, 'API did not expose the mirrored real pool');
  }
  await startApi();
  browser = spawn(process.execPath, ['scripts/e2e-blinks.mjs'], { cwd: server, env: { ...env, BASE: base, RPC: rpc, FUNDER_KEYPAIR: join(out, 'admin.json'), POOL_ID: '0', CHROME_PORT: String(await freePort()) }, stdio: 'inherit' });
  const code = await new Promise(resolve => browser.once('exit', resolve)); assert.equal(code, 0, 'Blink browser suite failed');
  // Keep the real mirrored pool, then disable its watcher: only the owner's reconcile request may credit the next buyer.
  await stop(app); env.WATCH_INTERVAL_MS = '0'; await startApi();
  browser = spawn(process.execPath, ['scripts/e2e-tickets.mjs'], { cwd: server, env: { ...env, BASE: base, RPC: rpc, POOL_ID: '0', CHROME_PORT: String(await freePort()) }, stdio: 'inherit' });
  const reconciled = await new Promise(resolve => browser.once('exit', resolve)); assert.equal(reconciled, 0, 'manual ticket reconciliation failed');
  result.manualReconcile = 'real wallet-signed payment; watcher disabled; browser retry, foreign refusal and duplicate credit checks';
  result.passed = true;
} catch (error) { result.error = error.message; console.error(error); process.exitCode = 1; }
finally {
  await stop(browser); await stop(app); await chain?.stop();
  if (madeDb) await adminDb.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
  await adminDb.$disconnect(); writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 }); console.log(`evidence: ${out}`);
}
