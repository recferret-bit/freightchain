// Checks the PRODUCTION environment (read from stdin as KEY=VALUE lines) with the server's own env schema under production rules – the same code that
// would refuse to boot on the server. Needs `npm run server:build` first (the schema is imported from server/dist).
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const schema = join(repo, 'backend', 'server', 'dist', 'infrastructure', 'config', 'env.schema.js');
if (!existsSync(schema)) { console.error('backend/server/dist is missing – run: npm run server:build'); process.exit(2); }
const { validateEnv } = await import(pathToFileURL(schema).href);
const require = createRequire(join(repo, 'backend', 'server', 'package.json'));

let text = '';
for await (const chunk of process.stdin) text += chunk;
const env = {};
for (const line of text.split('\n')) { const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line); if (m) env[m[1]] = m[2]; }

const problems = [];
try {
  // the server builds DATABASE_URL from POSTGRES_* inside compose – stand in with the same shape
  validateEnv({ ...env, NODE_ENV: 'production', DATABASE_URL: `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@postgres:5432/${env.POSTGRES_DB}`, REDIS_URL: `redis://:${env.REDIS_PASSWORD}@redis:6379` });
} catch (e) { problems.push(String(e.message).replace(/^Configuration validation error:\n/, '')); }
for (const key of ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']) if (!env[key]) problems.push(`${key} is empty`);
if (env.POSTGRES_PASSWORD && !/^[0-9a-f]{16,}$/.test(env.POSTGRES_PASSWORD)) problems.push('POSTGRES_PASSWORD must be lowercase hex, >= 16 chars (it goes into a URL unescaped)');
if (!env.REDIS_PASSWORD) problems.push('REDIS_PASSWORD is empty – the cache has a password and no published port. Add one: echo "REDIS_PASSWORD=$(openssl rand -hex 24)" >> infra/deploy/.env');
else if (!/^[0-9a-f]{32,}$/.test(env.REDIS_PASSWORD)) problems.push('REDIS_PASSWORD must be lowercase hex, >= 32 chars (it goes into a URL unescaped; openssl rand -hex 24)');
if (env.TRUST_PROXY !== '1') problems.push('TRUST_PROXY must be 1 (host nginx is exactly one reverse-proxy hop; any other value mis-reads client IPs)');
try { require.resolve('tweetnacl'); } catch { problems.push('backend/server/node_modules is missing – run: npm install --prefix backend/server'); }

// Devnet only: the server builds every payment transaction from SOLANA_RPC, so a mainnet endpoint would make riders pay REAL SOL. Ask the endpoint which chain it is.
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
if (env.SOLANA_RPC && process.env.ALLOW_NON_DEVNET !== '1') {
  try {
    const r = await fetch(env.SOLANA_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash' }), signal: AbortSignal.timeout(10_000) });
    const genesis = (await r.json()).result;
    if (genesis !== DEVNET_GENESIS) problems.push(`SOLANA_RPC is not a devnet endpoint (genesis ${genesis ?? 'unknown'}; devnet is ${DEVNET_GENESIS}) – a mainnet RPC would make riders pay real SOL. Use a DEVNET URL (ALLOW_NON_DEVNET=1 overrides)`);
  } catch (e) { problems.push(`SOLANA_RPC did not answer getGenesisHash (${e.message}) – check the URL`); }
}

if (problems.length) { console.error(problems.map((p) => `  - ${p.replace(/\n/g, '\n    ')}`).join('\n')); process.exit(1); }
console.log('production environment is valid');
