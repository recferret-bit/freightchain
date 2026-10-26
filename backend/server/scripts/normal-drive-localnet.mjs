// Disposable real-chain acceptance: a wallet buys a ticket, then drives the unchanged 1h course.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, openSync, closeSync, existsSync, symlinkSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { boundedFetch, sha256, snapshotSource, treeHashes, stopOwnedChild, sleep, withDeadline } from './normal-drive-support.mjs';
const sourceServer = fileURLToPath(new URL('..', import.meta.url)), root = resolve(sourceServer, '../..');
let server = sourceServer;
const scratch = mkdtempSync(join(tmpdir(), 'fc-normal-paid-')), db = `freightchain_normal_paid_${process.pid}`;
const path = `${homedir()}/.cargo/bin:${homedir()}/.local/share/solana/install/active_release/bin:${process.env.PATH}`;
const env = { PATH: path, HOME: homedir(), ENV_FILE: join(scratch, 'empty.env') };
writeFileSync(env.ENV_FILE, '');
const run = (bin, args, extra = {}) => execFileSync(bin, args, { cwd: server, env: { ...env, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, timeout: 180_000 });
let postgres = null;
const sql = query => run('docker', ['exec', postgres, 'psql', '-U', 'freight', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAc', query]);
const reserved = new Set();
const freePort = async () => { for (;;) { const port = await new Promise((ok, fail) => { const s = createServer(); s.on('error', fail); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => ok(port)); }); }); if (!reserved.has(port)) { reserved.add(port); return port; } } };
const children = [];
let cancelled = false;
const start = (bin, args, extra, log) => {
  if (cancelled) throw new Error('acceptance cancelled');
  const fd = openSync(join(scratch, log), 'w');
  const child = spawn(bin, args, { cwd: server, env: { ...env, ...extra }, stdio: ['ignore', fd, fd] });
  closeSync(fd); children.push(child); child.on('error', error => { child.spawnError = error; }); return child;
};
let created = false, closing;
const cleanup = () => closing ??= (async () => {
  const errors = [];
  for (const child of [...children].reverse()) try { await stopOwnedChild(child); } catch (error) { errors.push(error); }
  if (created) { try { sql(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`); created = false; } catch (error) { errors.push(error); } }
  if (!postgres && existsSync(join(scratch, 'postgres.cid'))) postgres = readFileSync(join(scratch, 'postgres.cid'), 'utf8').trim();
  if (postgres) {
    try { writeFileSync(join(scratch, 'postgres.log'), run('docker', ['logs', postgres])); } catch {}
    try { run('docker', ['rm', '--force', '--volumes', postgres]); postgres = null; } catch (error) { errors.push(error); }
  }
  console.log(`artifacts retained: ${scratch}`);
  if (errors.length) throw new AggregateError(errors, 'owned acceptance cleanup failed');
})();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  cancelled = true;
  void cleanup().then(() => process.exit(signal === 'SIGINT' ? 130 : 143), error => { console.error(error); process.exit(1); });
});
console.log(`normal paid acceptance artifacts: ${scratch}`);
try {
  const snapshot = join(scratch, 'source'), source = snapshotSource(root, snapshot);
  server = join(snapshot, 'backend/server');
  symlinkSync(join(sourceServer, 'node_modules'), join(server, 'node_modules'), 'dir');
  run('node', ['node_modules/@nestjs/cli/bin/nest.js', 'build']); // Use the installed generated client; never regenerate shared dependencies.
  const { PoolProgramCodec } = await import(pathToFileURL(join(server, 'dist/infrastructure/solana/pool-program.codec.js')));
  const { POOL_PROGRAM_IDL } = await import(pathToFileURL(join(server, 'dist/infrastructure/solana/pool-program.idl.js')));
  const { initialize, pdas, PROGRAM_ID } = await import(pathToFileURL(join(server, 'scripts/honk-program.mjs')));
  const { sealRoad } = await import(pathToFileURL(join(server, 'scripts/localnet-seal.mjs')));
  const inputPrograms = process.env.PROGRAM_ARTIFACT_DIR || join(root, 'backend/programs/target/deploy');
  const programs = join(scratch, 'programs'); mkdirSync(programs);
  for (const name of ['freightchain_pools', 'freightchain_honk']) {
    if (!existsSync(join(inputPrograms, `${name}.so`))) throw new Error(`missing ${name}.so`);
    copyFileSync(join(inputPrograms, `${name}.so`), join(programs, `${name}.so`));
  }
  const postgresImage = JSON.parse(run('docker', ['image', 'inspect', 'postgres:17-alpine']))[0].Id;
  const manifest = { postgresImage, node: process.version, source, build: treeHashes(join(server, 'dist')), programs: treeHashes(programs), artifactSource: inputPrograms };
  writeFileSync(join(scratch, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const payer = Keypair.generate(), player = Keypair.generate(), treasury = Keypair.generate();
  for (const [name, key] of Object.entries({ payer, player, treasury })) writeFileSync(join(scratch, `${name}.json`), JSON.stringify([...key.secretKey]), { mode: 0o600 });
  let rpcPort;
  for (;;) { rpcPort = await freePort(); const s = createServer(); try { await new Promise((ok, fail) => { s.once('error', fail); s.listen(rpcPort + 1, '127.0.0.1', ok); }); await new Promise(ok => s.close(ok)); reserved.add(rpcPort + 1); break; } catch {} }
  const rpc = `http://127.0.0.1:${rpcPort}`, faucet = await freePort(), gossip = await freePort();
  const dynamicStart = Math.min(await freePort(), 65000), dynamicRange = `${dynamicStart}-${dynamicStart + 30}`;
  const validator = start('solana-test-validator', ['--ledger', join(scratch, 'ledger'), '--reset', '--quiet', '--bind-address', '127.0.0.1', '--rpc-port', String(rpcPort), '--faucet-port', String(faucet), '--gossip-port', String(gossip), '--dynamic-port-range', dynamicRange, '--mint', payer.publicKey.toBase58(), '--upgradeable-program', POOL_PROGRAM_IDL.address, join(programs, 'freightchain_pools.so'), join(scratch, 'payer.json'), '--upgradeable-program', PROGRAM_ID.toBase58(), join(programs, 'freightchain_honk.so'), join(scratch, 'payer.json')], {}, 'validator.log');
  const conn = new Connection(rpc, { commitment: 'confirmed', fetch: boundedFetch, disableRetryOnRateLimit: true });
  const validatorReadyBy = Date.now() + 90_000;
  for (;;) { try { await conn.getVersion(); break; } catch { if (Date.now() > validatorReadyBy || validator.exitCode !== null || validator.signalCode !== null || validator.spawnError) throw new Error('validator did not start'); await sleep(1000); } }
  await sendAndConfirmTransaction(conn, new Transaction().add(...[player, treasury].map(k => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports: 2e9 }))), [payer]);
  await withDeadline(() => initialize({ rpc, payer, solIn: 50_000_000_000n }), 90_000, 'TEN4 initialization');
  const admin = args => JSON.parse(run('node', ['scripts/pool-admin.mjs', ...args, '--url', rpc]).trim().split('\n').pop());
  const pub = treasury.publicKey.toBase58(), key = join(scratch, 'payer.json');
  admin(['initialize', '-k', key, '--admin', payer.publicKey.toBase58(), '--platform-treasury', pub, '--platform-fee-bps', '500']);
  const pool = admin(['create-pool', '-k', key, '--tier', '1h', '--price', '50000000', '--min', '0', '--per-wallet', '3', '--prep', '+3600', '--play', '+18000', '--payout', '+21600', '--last-start', '+3600', '--split', '8500/500/1000', '--fee-treasury', pub, '--seed-treasury', pub]);
  admin(['sponsor', '-k', key, '--pool', String(pool.poolId), '--lamports', '60000000']);
  await sealRoad({ conn, codec: new PoolProgramCodec(POOL_PROGRAM_IDL.address), admintool: admin, id: pool.poolId, keyfile: key });
  const postgresPort = await freePort();
  postgres = run('docker', ['run', '--detach', '--cidfile', join(scratch, 'postgres.cid'), '--name', `fc-normal-pg-${process.pid}`, '--label', 'freightchain.test=normal-drive', '--publish', `127.0.0.1:${postgresPort}:5432`, '--env', 'POSTGRES_USER=freight', '--env', 'POSTGRES_PASSWORD=normal_paid_disposable', postgresImage]).trim();
  for (let i = 0; ; i++) { try { sql('SELECT 1'); break; } catch { if (i > 60) throw new Error('owned PostgreSQL did not become ready'); await sleep(500); } }
  sql(`CREATE DATABASE "${db}"`); created = true;
  const database = `postgresql://freight:normal_paid_disposable@127.0.0.1:${postgresPort}/${db}`;
  run('./node_modules/.bin/prisma', ['migrate', 'deploy'], { DATABASE_URL: database });
  run('docker', ['exec', postgres, 'psql', '-U', 'freight', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', `UPDATE player."GameSetting" SET value=0 WHERE key='weekly_ticket_1h_enabled'`]);
  const port = await freePort(), base = `http://localhost:${port}`;
  const appEnv = { DATABASE_URL: database, CLIENT_DIR: join(snapshot, 'frontend/client'), PORT: String(port), NODE_ENV: 'development', PRIZE_DEV_DEFAULT_COUNTRY: 'CA', JWT_SECRET: 'normal-paid-local-test-only-generated-wallets', TREASURY_PUBKEY: pub, SOL_USD: '118', SOLANA_RPC: rpc, SOLANA_WS: rpc.replace('http:', 'ws:').replace(`:${rpcPort}`, `:${rpcPort + 1}`), SNS_RPC: 'http://127.0.0.1:9', PAYMENT_MODE: 'program', TICKET_PROGRAM_ID: POOL_PROGRAM_IDL.address, WATCH_INTERVAL_MS: '2000', CRANK_INTERVAL_MS: '0', PAYOUT_INTERVAL_MS: '0', VERDICT_ENFORCE: 'true', TRAFFIC_PROOF_REQUIRED: 'true', POSTHOG_ENABLED: '0', DEMO_WALLETS: '', HONK_PROGRAM_ID: PROGRAM_ID.toBase58(), HONK_EMITTER_SECRET: JSON.stringify([...payer.secretKey]), HONK_MINT: pdas().honkMint.toBase58(), LIVE_DONATIONS: 'off', LIVE_EFFECTS: 'off' };
  run('node', ['dist/cli/index.js', 'pool:register', String(pool.poolId), '--label', 'NORMAL LOCAL 1H'], appEnv);
  const api = start('node', ['dist/main.js'], appEnv, 'server.log');
  const apiReadyBy = Date.now() + 45_000;
  for (;;) { try { if ((await boundedFetch(`${base}/api/health/live`, {}, 2000)).ok) break; } catch {} if (Date.now() > apiReadyBy || api.exitCode !== null || api.signalCode !== null || api.spawnError) throw new Error('API did not start'); await sleep(500); }
  const proof = { NORMAL_DRIVE_ANGLE: process.env.NORMAL_DRIVE_ANGLE || '', BASE: base, RPC: rpc, NORMAL_PAID_KEY: join(scratch, 'player.json'), NORMAL_PAID_POOL: String(pool.poolId), CHROME_PORT: String(await freePort()), ...(process.env.CHROME && { CHROME: process.env.CHROME }) };
  writeFileSync(join(scratch, 'run.json'), JSON.stringify({ base, rpc, poolId: pool.poolId, wallet: player.publicKey.toBase58(), database: db, postgresContainer: postgres, postgresPort, programs, dynamicRange, manifestSha256: sha256(readFileSync(join(scratch, 'manifest.json'))) }, null, 2));
  if (cancelled) throw new Error('acceptance cancelled');
  const child = spawn('node', ['scripts/e2e-normal-drive.mjs'], { cwd: server, env: { ...env, ...proof }, stdio: 'inherit' }); children.push(child);
  const browserExit = new Promise((ok, fail) => { child.once('exit', ok); child.once('error', fail); });
  const code = await withDeadline(() => browserExit, 110 * 60_000, 'paid browser acceptance');
  if (code !== 0) throw new Error(`normal paid browser exited ${code}`);
  const records = JSON.parse(run('docker', ['exec', postgres, 'psql', '-U', 'freight', '-d', db, '-v', 'ON_ERROR_STOP=1', '-tAc', `SELECT coalesce(json_agg(m), '[]'::json) FROM (SELECT "rideId", released, "chainPending", "chainSentAt" FROM economy."HonkMint" WHERE wallet='${player.publicKey.toBase58()}') m`]).trim());
  if (records.length !== 1 || !records[0].released || records[0].chainPending || !records[0].chainSentAt) throw new Error('expected exactly one settled reward outbox record');
  const [receipt] = PublicKey.findProgramAddressSync([Buffer.from('ride-mint'), Buffer.from(records[0].rideId.replace(/-/g, ''), 'hex')], PROGRAM_ID);
  const account = await conn.getAccountInfo(receipt), data = account?.data;
  if (!account?.owner.equals(PROGRAM_ID) || data.length !== 52 || data.subarray(0, 8).toString('hex') !== sha256('account:RideMint').slice(0, 16) || data.readBigUInt64LE(8) !== 100_000_000n || !data.subarray(16, 48).equals(player.publicKey.toBuffer()) || data[48] !== 1 || data[49] !== 7) throw new Error('settled ride receipt does not match its exact reward');
  writeFileSync(join(scratch, 'reward.json'), JSON.stringify({ records, receipt: receipt.toBase58(), amountBaseUnits: '100000000' }, null, 2));
  console.log('PASS isolated normal paid acceptance and settled unique reward receipt');
} finally {
  await cleanup();
}
