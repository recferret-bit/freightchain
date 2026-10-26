// Scratch-only validator lifecycle. Keys and ledger are independent of every developer/localnet fixture.
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, openSync } from 'node:fs';
import { join } from 'node:path';
const PROGRAM = '8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p';
const PIN = 'c32477bcef6f31d489b6aefc08e50e23c481eceffd64ea2dc8ad4bbd11ae41f4';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = () => new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); }); });
export async function prepareChain({ root, out, fixture, result }) {
  const require = createRequire(join(root, 'backend/server/package.json'));
  const { Keypair } = require('@solana/web3.js');
  const artifact = process.env.POOLS_ARTIFACT || join(root, 'backend/programs/target/deploy/freightchain_pools.so');
  const hash = createHash('sha256').update(readFileSync(artifact)).digest('hex');
  const executableHash = execFileSync('solana-verify', ['get-executable-hash', artifact], { encoding: 'utf8' }).trim();
  if (executableHash !== PIN) throw new Error('pool executable differs from the reviewed artifact pin; rebuild and explicitly review the new pin');
  const keys = Object.fromEntries(['admin', 'player', 'fee', 'seed'].map(name => {
    const key = Keypair.generate(); writeFileSync(join(out, `${name}.json`), JSON.stringify([...key.secretKey]), { mode: 0o600 }); return [name, key.publicKey.toBase58()];
  }));
  const rpcPort = await port(), gossipPort = await port(), faucetPort = await port(), dynamicPort = randomInt(21000, 39000);
  const rpc = `http://127.0.0.1:${rpcPort}`;
  const log = openSync(join(out, 'validator.log'), 'a', 0o600);
  const validator = spawn('solana-test-validator', ['--reset', '--quiet', '--ledger', join(out, 'ledger'), '--bind-address', '127.0.0.1', '--rpc-port', String(rpcPort), '--gossip-port', String(gossipPort), '--faucet-port', String(faucetPort), '--dynamic-port-range', `${dynamicPort}-${dynamicPort + 30}`, '--mint', keys.admin, '--upgradeable-program', PROGRAM, artifact, keys.admin], { stdio: ['ignore', log, log] });
  let relay, startupError;
  validator.once('error', error => { startupError = error; });
  const stop = async () => { relay?.kill('SIGTERM'); validator.kill('SIGTERM'); await Promise.race([new Promise(resolve => validator.once('exit', resolve)), sleep(10000)]); if (validator.exitCode === null) validator.kill('SIGKILL'); };
  try {
    let ready = false;
    for (let n = 0; n < 120; n++) {
      if (startupError) throw startupError;
      if (validator.exitCode !== null) throw new Error('scratch validator exited; see validator.log');
      try { const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}', signal: AbortSignal.timeout(1000) }); if ((await r.json()).result === 'ok') { ready = true; break; } } catch {}
      await sleep(1000);
    }
    if (!ready) throw new Error('scratch validator not ready');
    Object.assign(fixture, { PAYMENT_MODE: 'program', TELEMETRY_V21: 'enforce', TICKET_PROGRAM_ID: PROGRAM, SOLANA_RPC: 'http://rpc:8899', WATCH_INTERVAL_MS: '1000', TREASURY_PUBKEY: keys.fee, FEE_TREASURY: keys.fee, SEED_TREASURY: keys.seed, ADMIN_WALLETS: keys.admin });
    Object.assign(result, { chain: 'real scratch validator through stdio JSON-RPC relay; production HTTP polling', poolArtifactSha256: hash, poolExecutableHash: executableHash, validatorRpc: rpc });
    return {
      stop,
      extend(model) {
        const volume = (source, target) => ({ type: 'bind', source, target, read_only: true });
        const scripts = join(root, 'infra/deploy/scripts');
        model.services.rpc = { image: model.services.app.image, command: ['node', '/relay.mjs', 'serve'], stdin_open: true, tty: false, ports: [], restart: 'no', healthcheck: { disable: true }, networks: { default: null }, volumes: [volume(join(scripts, 'local-rpc-relay.mjs'), '/relay.mjs')] };
        model.services['chain-probe'] = { user: '0:0', image: model.services.app.image, command: ['node', '-e', 'setInterval(()=>{},100000)'], ports: [], restart: 'no', healthcheck: { disable: true }, networks: { default: null }, environment: { RPC: 'http://rpc:8899', BASE: 'http://app:3000', KEYS: '/fixture' }, volumes: [volume(out, '/fixture'), volume(join(root, 'backend/server/scripts'), '/app/backend/server/scripts'), volume(join(scripts, 'local-production-rpc-scenario.mjs'), '/app/backend/server/production-rpc.mjs')] };
      },
      connect(container) { relay?.kill('SIGTERM'); relay = spawn(process.execPath, [join(root, 'infra/deploy/scripts/local-rpc-relay.mjs'), 'attach', container, rpc], { stdio: ['ignore', log, log] }); },
    };
  } catch (error) { await stop(); throw error; }
}
