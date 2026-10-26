// Disposable production-mode startup/recovery check. Never reads deploy/.env or calls release.sh.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = mkdtempSync(join(tmpdir(), 'fc-production-smoke-'));
const project = `fc-production-smoke-${process.pid}`;
const envFile = join(out, 'fixture.env'), composeFile = join(out, 'compose.json');
const services = ['postgres', 'redis', 'app', 'worker', 'mcp', 'editor-worker'];
const secret = () => randomBytes(32).toString('hex');
// Keep Docker's local configuration, without inheriting application credentials or Compose interpolation values.
const dockerEnv = Object.fromEntries(['PATH', 'HOME', 'DOCKER_CONFIG', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const fixture = {
  RELEASE: 'local-readiness', POSTGRES_USER: 'freight', POSTGRES_PASSWORD: secret(), POSTGRES_DB: 'freightchain_production_smoke_test', REDIS_PASSWORD: secret(),
  IP_HASH_SECRET: secret(), JWT_SECRET: secret(), ADMIN_JWT_SECRET: secret(), EDITOR_JWT_SECRET: secret(), EDITOR_MCP_TOKEN: secret(),
  ADMIN_WALLETS: 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn', EDITOR_WALLETS: 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn',
  ADMIN_ALERT_TELEGRAM_BOT_TOKEN: 'local-test-token-not-real', ADMIN_ALERT_TELEGRAM_CHAT_ID: 'local-test-chat-not-real',
  TREASURY_PUBKEY: 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn', APP_DOMAIN: 'freightchain.localhost', APP_ORIGIN: 'https://freightchain.localhost', COOKIE_DOMAIN: 'freightchain.localhost', CORS_ORIGINS: 'https://freightchain.localhost',
  SOLANA_RPC: 'http://127.0.0.1:9', SNS_RPC: 'http://127.0.0.1:9', SOL_USD: '118', WATCH_INTERVAL_MS: '0', CRANK_INTERVAL_MS: '0', PAYOUT_INTERVAL_MS: '0',
  POSTHOG_ENABLED: '0', POSTHOG_DISABLED: '1', VERDICT_ENFORCE: 'true',
};
let commandId = 0, modelReady = false, stopping = false;
const checks = [];
const result = { project, output: out, passed: false, checks, chain: 'disabled: startup check only', providers: 'no real credentials; external networking disabled' };
const check = (message, ok) => { if (!ok) throw new Error(message); checks.push(message); console.log(`ok   ${message}`); };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopping = true; });

function docker(args, { allowFailure = false, timeout = 180_000, input } = {}) {
  const run = spawnSync('docker', args, { cwd: root, env: dockerEnv, encoding: 'utf8', input, timeout, maxBuffer: 32 * 1024 * 1024 });
  const log = join(out, `command-${++commandId}.log`);
  writeFileSync(log, (run.stdout || '') + (run.stderr || '') + (run.error ? `\n${run.error.message}` : ''), { mode: 0o600 });
  if (run.status !== 0 && !allowFailure) throw new Error(`Docker command ${commandId} failed; details: ${log}`);
  return { status: run.status, stdout: run.stdout || '', stderr: run.stderr || '' };
}
const compose = (args, options) => docker(['compose', '--project-name', project, '--env-file', envFile, '-f', composeFile, ...args], options);
const runNode = (service, source, options) => compose(['exec', '-T', service, 'node', '--input-type=module', '-e', source], options);
const probe = (service, port, path, status) => {
  const source = `const r=await fetch('http://127.0.0.1:${port}${path}',{signal:AbortSignal.timeout(10000)});if(r.status!==${status})throw new Error('expected ${status}, got '+r.status);`;
  runNode(service, source);
};
function testSubnets(count) {
  const ids = docker(['network', 'ls', '--quiet']).stdout.trim().split(/\s+/).filter(Boolean);
  const networks = ids.length ? JSON.parse(docker(['network', 'inspect', ...ids]).stdout) : [];
  const number = ip => ip.split('.').reduce((value, byte) => value * 256 + Number(byte), 0);
  const range = cidr => { const [ip, bits] = cidr.split('/'), size = 2 ** (32 - Number(bits)), start = Math.floor(number(ip) / size) * size; return [start, start + size - 1]; };
  const used = networks.flatMap(network => network.IPAM?.Config || []).map(config => config.Subnet).filter(cidr => cidr && !cidr.includes(':')).map(range);
  const chosen = [], offset = randomBytes(2).readUInt16BE() % 8192;
  // Internal /28s leave room for one-off migration/refusal containers without consuming the daemon's default /16 pool.
  for (let i = 0; i < 8192 && chosen.length < count; i++) {
    const address = number('198.18.0.0') + ((offset + i) % 8192) * 16;
    if (used.some(([start, end]) => address <= end && address + 15 >= start)) continue;
    chosen.push([24, 16, 8, 0].map(shift => Math.floor(address / 2 ** shift) % 256).join('.') + '/28');
  }
  if (chosen.length !== count) throw new Error('no unused internal Docker test subnets available');
  return chosen;
}
async function healthy(names) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('smoke test interrupted');
    const good = names.every(service => {
      const id = compose(['ps', '-q', service]).stdout.trim();
      return id && docker(['inspect', '--format', '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}', id]).stdout.trim() === 'running healthy';
    });
    if (good) return;
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  throw new Error(`services did not become healthy: ${names.join(', ')}`);
}

try {
  const endpoint = dockerEnv.DOCKER_HOST || docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).stdout.trim();
  check('Docker endpoint is local', /^(unix:|npipe:|tcp:\/\/(localhost|127\.0\.0\.1|\[::1\]):)/.test(endpoint));
  writeFileSync(envFile, Object.entries(fixture).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  const rendered = docker(['compose', '--project-name', project, '--env-file', envFile, '-f', resolve(root, 'infra/deploy/docker-compose.prod.yml'), 'config', '--format', 'json']);
  const model = JSON.parse(rendered.stdout);
  model.name = project;
  model.networks.default = { internal: true };
  const subnets = testSubnets(Object.keys(model.networks).length);
  for (const network of Object.values(model.networks)) network.ipam = { config: [{ subnet: subnets.shift() }] };
  // Preserve all service configuration, including strict flags, dependencies, healthchecks and Redis ACL.
  // Only resource names, host exposure and outbound access differ from the release stack.
  for (const service of Object.values(model.services)) { service.ports = []; service.restart = 'no'; }
  writeFileSync(composeFile, JSON.stringify(model, null, 2), { mode: 0o600 });
  modelReady = true;
  check('all test networks are internal and no service publishes a port', Object.values(model.networks).every(network => network.internal) && Object.values(model.services).every(service => service.ports.length === 0));
  if (!process.argv.includes('--no-build')) {
    console.log('building current server and MCP images');
    compose(['build', 'app', 'mcp'], { timeout: 1_200_000 });
  }
  for (const service of ['app', 'mcp']) {
    const image = model.services[service].image;
    result[`${service}Image`] = docker(['image', 'inspect', '--format', '{{.Id}}', image]).stdout.trim();
  }
  compose(['up', '-d', 'postgres', 'redis']);
  await healthy(['postgres', 'redis']);
  compose(['run', '--rm', '--no-deps', 'app', './node_modules/.bin/prisma', 'migrate', 'deploy']);
  check('forward migrations apply to the disposable database', true);
  compose(['up', '-d', ...services]);
  await healthy(services);
  probe('app', 3000, '/api/health/live', 200); probe('app', 3000, '/api/health/ready', 200); probe('mcp', 3100, '/health', 200);
  check('API, replay worker, editor worker and MCP are healthy in production mode', true);
  check('the replay worker entered its processing loop', compose(['logs', '--no-color', 'worker']).stdout.includes('replay-worker.start'));
  for (const service of ['app', 'worker', 'editor-worker']) {
    runNode(service, "const {validateEnv}=await import('./dist/infrastructure/config/env.schema.js');const e=validateEnv(process.env);if(e.NODE_ENV!=='production'||e.LIVE_EFFECTS!=='off'||e.LIVE_FREE_DONATIONS!=='off')throw new Error('invalid production defaults');");
    const refused = compose(['run', '--rm', '--no-deps', '-e', 'LIVE_EFFECTS=free', service, 'node', '--input-type=module', '-e', "const {validateEnv}=await import('./dist/infrastructure/config/env.schema.js');validateEnv(process.env);"], { allowFailure: true });
    check(`${service} still refuses gameplay effects in production`, refused.status !== 0 && refused.stderr.includes('LIVE_EFFECTS: must be off'));
  }
  const sql = (database, source) => compose(['exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'freight', '-d', database, '-tAc', source]).stdout.trim();
  sql(fixture.POSTGRES_DB, 'CREATE TABLE public.production_smoke_marker (value integer); INSERT INTO public.production_smoke_marker VALUES (1729)');
  const dump = compose(['exec', '-T', 'postgres', 'pg_dump', '-U', 'freight', fixture.POSTGRES_DB]).stdout;
  const restored = 'freightchain_production_restore_test';
  compose(['exec', '-T', 'postgres', 'createdb', '-U', 'freight', restored]);
  compose(['exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'freight', '-d', restored], { input: dump });
  check('a real PostgreSQL backup restores schema, migrations and test data', sql(restored, 'SELECT value FROM public.production_smoke_marker') === '1729' && Number(sql(restored, 'SELECT count(*) FROM public."_prisma_migrations"')) > 0);
  compose(['stop', 'redis']);
  probe('mcp', 3100, '/health', 503);
  check('MCP health fails closed during a real Redis outage', true);
  compose(['start', 'redis']); await healthy(services);
  probe('mcp', 3100, '/health', 200);
  check('Redis and MCP recover without recreating the API', true);
  compose(['stop', 'postgres']);
  probe('app', 3000, '/api/health/ready', 503);
  check('API readiness refuses traffic during a real PostgreSQL outage', true);
  compose(['start', 'postgres']); await healthy(services);
  probe('app', 3000, '/api/health/ready', 200);
  check('API and workers recover after PostgreSQL restarts', true);
  compose(['restart', 'app', 'worker', 'editor-worker', 'mcp']); await healthy(services);
  probe('app', 3000, '/api/health/ready', 200); probe('mcp', 3100, '/health', 200);
  check('all application processes recover after a restart', true);
  result.passed = true;
} catch (error) {
  result.error = error.message;
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  if (modelReady) {
    compose(['logs', '--no-color'], { allowFailure: true });
    const cleanup = compose(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
    if (cleanup.status !== 0) { result.cleanupFailed = true; process.exitCode = 1; console.error(`FAIL cleanup of ${project}; see ${out}`); }
  }
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(`evidence: ${out}`);
}
