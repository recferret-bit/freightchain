// Creates deploy/.env from deploy/.env.example with fresh secrets, and a dedicated treasury keypair kept LOCALLY.
//   node init-env.mjs [--domain d] [--email e]
// The treasury secret goes to deploy/secrets/treasury.json (gitignored, never uploaded); only its PUBLIC key goes into deploy/.env.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const deploy = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const target = join(deploy, '.env');
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

if (existsSync(target)) { console.error(`${target} already exists – not overwriting it (delete it first to start over)`); process.exit(1); }

const require = createRequire(join(deploy, '..', 'server', 'package.json'));
const nacl = require('tweetnacl'); const bs58 = require('bs58');

const secrets = join(deploy, 'secrets'), keyFile = join(secrets, 'treasury.json');
let publicKey;
if (existsSync(keyFile)) publicKey = JSON.parse(readFileSync(keyFile, 'utf8')).publicKey;
else {
  const kp = nacl.sign.keyPair();
  publicKey = (bs58.default ?? bs58).encode(kp.publicKey);
  mkdirSync(secrets, { recursive: true });
  writeFileSync(keyFile, JSON.stringify({ publicKey, secretKey: (bs58.default ?? bs58).encode(kp.secretKey) }, null, 2), { mode: 0o600 });
  console.log(`treasury keypair created: ${keyFile}  (KEEP THE SECRET SAFE – it is the only way to move the entry fees)`);
}

const values = {
  POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
  REDIS_PASSWORD: randomBytes(24).toString('hex'),
  JWT_SECRET: randomBytes(32).toString('hex'),
  TREASURY_PUBKEY: publicKey,
  DEPLOY_ADMIN_PASSWORD: randomBytes(18).toString('base64url'),
  ADMIN_JWT_SECRET: randomBytes(32).toString('hex'),
  ...(arg('domain') ? { DEPLOY_DOMAIN: arg('domain') } : {}),
  ...(arg('email') ? { DEPLOY_LETSENCRYPT_EMAIL: arg('email') } : {}),
};
const out = readFileSync(join(deploy, '.env.example'), 'utf8').split('\n').map((line) => {
  const m = /^([A-Z_]+)=/.exec(line);
  return m && m[1] in values ? `${m[1]}=${values[m[1]]}` : line;
}).join('\n');
writeFileSync(target, out, { mode: 0o600 });
chmodSync(target, 0o600);
console.log(`created ${target} (chmod 600) with a fresh POSTGRES_PASSWORD, REDIS_PASSWORD, JWT_SECRET, ADMIN_JWT_SECRET, DEPLOY_ADMIN_PASSWORD and TREASURY_PUBKEY=${publicKey}`);
const left = out.split('\n').filter((l) => /^[A-Z_]+=CHANGE_ME/.test(l)).map((l) => l.split('=')[0]);
console.log(left.length ? `still to set by hand in deploy/.env: ${left.join(', ')}` : 'nothing left to set by hand');
