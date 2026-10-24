import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Keypair } from '@solana/web3.js';
import { validateEnv } from '../../../src/infrastructure/config/env.schema.js';

const compose = readFileSync(new URL('../../../../../infra/deploy/docker-compose.prod.yml', import.meta.url), 'utf8');
const fixture: Record<string, string> = {
  POSTGRES_USER: 'freight', POSTGRES_PASSWORD: 'local-test-password', POSTGRES_DB: 'freightchain_production_smoke_test', REDIS_PASSWORD: 'a'.repeat(48),
  JWT_SECRET: 'j'.repeat(48), ADMIN_JWT_SECRET: 'a'.repeat(48), EDITOR_JWT_SECRET: 'e'.repeat(48), EDITOR_MCP_TOKEN: 'm'.repeat(48),
  ADMIN_ALERT_TELEGRAM_BOT_TOKEN: 'local-test-token', ADMIN_ALERT_TELEGRAM_CHAT_ID: 'local-test-chat',
  ADMIN_WALLETS: Keypair.generate().publicKey.toBase58(), EDITOR_WALLETS: Keypair.generate().publicKey.toBase58(),
  TREASURY_PUBKEY: Keypair.generate().publicKey.toBase58(), APP_DOMAIN: 'freightchain.localhost', APP_ORIGIN: 'https://freightchain.localhost', COOKIE_DOMAIN: 'freightchain.localhost', CORS_ORIGINS: 'https://freightchain.localhost',
};

// Read the actual service bindings: pre-populating expected strict flags would hide omitted Compose entries.
function environment(service: string, values = fixture): Record<string, string> {
  const block = compose.split(`\n  ${service}:\n`)[1]!.split(/\n  [a-z][a-z-]*:\n|\nnetworks:\n/)[0]!;
  const result: Record<string, string> = {};
  for (const [, key, raw] of block.matchAll(/^      ([A-Z0-9_]+):\s*(.+)$/gm)) {
    result[key!] = raw!.replace(/\s+#.*$/, '').replace(/^(["'])(.*)\1$/, '$2').replace(/\$\{([A-Z0-9_]+)(?::([-?])([^}]*))?\}/g, (_match, name: string, mode: string, fallback: string) => {
      const value = values[name];
      if (mode === '?' && !value) throw new Error(`missing fixture ${name}`);
      return value || (mode === '-' ? fallback : '');
    });
  }
  return result;
}

describe('production Compose startup configuration', () => {
  for (const service of ['app', 'worker', 'editor-worker']) it(`${service} passes actual strict configuration with the default flags`, () => {
    const config = validateEnv(environment(service));
    expect(config).toMatchObject({ NODE_ENV: 'production', LIVE_FREE_DONATIONS: 'off', LIVE_EFFECTS: 'off', MINIGAMES: 'off', TELEMETRY_V21: 'off', EDITOR_FAKE_LLM: '0' });
    expect(config.JWT_SECRET).toBe(fixture.JWT_SECRET);
  });

  for (const service of ['app', 'worker']) it(`${service} receives privileged session and alert configuration without bypassing missing-value checks`, () => {
    const config = validateEnv(environment(service));
    expect(config).toMatchObject({ ADMIN_JWT_SECRET: fixture.ADMIN_JWT_SECRET, EDITOR_JWT_SECRET: fixture.EDITOR_JWT_SECRET, ADMIN_ALERT_TELEGRAM_BOT_TOKEN: fixture.ADMIN_ALERT_TELEGRAM_BOT_TOKEN, ADMIN_ALERT_TELEGRAM_CHAT_ID: fixture.ADMIN_ALERT_TELEGRAM_CHAT_ID });
    for (const key of ['ADMIN_JWT_SECRET', 'EDITOR_JWT_SECRET', 'ADMIN_ALERT_TELEGRAM_BOT_TOKEN', 'ADMIN_ALERT_TELEGRAM_CHAT_ID']) {
      expect(() => validateEnv(environment(service, { ...fixture, [key]: '' })), key).toThrow(key);
    }
  });

  it('session defaults match the 60-minute cap and the two session keys stay distinct', () => {
    const config = validateEnv(environment('app'));
    expect(config.ADMIN_SESSION_TTL_MINUTES).toBe(60);
    expect(config.EDITOR_SESSION_TTL_MINUTES).toBe(60);
    expect(() => validateEnv(environment('app', { ...fixture, EDITOR_JWT_SECRET: fixture.ADMIN_JWT_SECRET! }))).toThrow('ADMIN_JWT_SECRET: must differ from EDITOR_JWT_SECRET');
  });

  it('a fresh deployment gets three distinct session keys and never overwrites an existing env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fc-init-env-test-')), deploy = join(dir, 'infra/deploy'), server = join(dir, 'backend/server');
    try {
      mkdirSync(join(deploy, 'scripts'), { recursive: true }); mkdirSync(server, { recursive: true });
      writeFileSync(join(server, 'package.json'), '{}');
      symlinkSync(resolve('node_modules'), join(server, 'node_modules'), 'dir');
      copyFileSync(resolve('../../infra/deploy/.env.example'), join(deploy, '.env.example'));
      copyFileSync(resolve('../../infra/deploy/scripts/init-env.mjs'), join(deploy, 'scripts/init-env.mjs'));
      const run = () => spawnSync(process.execPath, [join(deploy, 'scripts/init-env.mjs')], { encoding: 'utf8' });
      const first = run(); expect(first.status, first.stderr).toBe(0);
      const saved = readFileSync(join(deploy, '.env'), 'utf8');
      const values = Object.fromEntries([...saved.matchAll(/^([A-Z_]+)=(.*)$/gm)].map(([, key, value]) => [key, value]));
      const keys = ['JWT_SECRET', 'ADMIN_JWT_SECRET', 'EDITOR_JWT_SECRET'].map(key => values[key]!);
      expect(keys.every(key => /^[a-f0-9]{64}$/.test(key))).toBe(true);
      expect(new Set(keys).size).toBe(3);
      expect(keys.some(key => first.stdout.includes(key))).toBe(false);
      expect(run().status).toBe(1);
      expect(readFileSync(join(deploy, '.env'), 'utf8')).toBe(saved);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
