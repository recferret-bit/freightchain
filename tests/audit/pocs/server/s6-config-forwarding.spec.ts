import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { envSchema, validateEnv } from '../../../src/infrastructure/config/env.schema.js';

const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const read = (path: string) => readFileSync(`${repo}${path}`, 'utf8');
const schemaKeys = () => Object.keys(envSchema.innerType().shape);
const fixedByImage = new Set(['CLIENT_DIR', 'LANDING_DIR']);
const generatedForDeploy = new Set(['NODE_ENV', 'PORT', 'DATABASE_URL', 'REDIS_URL', 'APP_DOMAIN', 'APP_ORIGIN', 'COOKIE_DOMAIN', 'CORS_ORIGINS', ...fixedByImage]);
/** Project only key names: no example or real env values are printed. */
const exampleKeys = (path: string) => new Set([...read(path).matchAll(/^([A-Z_0-9]+)=/gm)].map((m) => m[1]));

describe('S6: configuration forwarding controls', () => {
  it('forwards every runtime schema key from production compose, except image-fixed static roots', () => {
    const app = read('infra/deploy/docker-compose.prod.yml').split('  app:')[1]!.split('    environment:')[1]!.split('    # loopback')[0]!;
    const forwarded = new Set([...app.matchAll(/^      ([A-Z_0-9]+):/gm)].map((m) => m[1]));
    expect(schemaKeys().filter((key) => !fixedByImage.has(key) && !forwarded.has(key))).toEqual([]);
  });

  it('lists all non-generated schema keys in the production example', () => {
    const keys = exampleKeys('infra/deploy/.env.example');
    expect(schemaKeys().filter((key) => !generatedForDeploy.has(key) && !keys.has(key))).toEqual([]);
  });

  it('has no security-knob omissions in the local example (the optional Redis URL alone is absent)', () => {
    const keys = exampleKeys('backend/server/.env.example');
    expect(schemaKeys().filter((key) => !keys.has(key))).toEqual(['REDIS_URL']);
  });

  it('rejects absent and short JWT secrets in production, rather than selecting a public dev fallback', () => {
    const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://unused', TRUST_PROXY: '1', TREASURY_PUBKEY: '11111111111111111111111111111111' };
    expect(() => validateEnv(prod)).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...prod, JWT_SECRET: '' })).toThrow(/JWT_SECRET/);
    expect(() => validateEnv({ ...prod, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('trusting exactly the nginx hop ignores a supplied X-Forwarded-For prefix', () => {
    const proxyaddr = createRequire(import.meta.url)('proxy-addr') as (req: unknown, trust: (address: string, hop: number) => boolean) => string;
    const request = { connection: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.42, 203.0.113.9' } };
    expect(proxyaddr(request, (_address, hop) => hop < 1)).toBe('203.0.113.9');
  });

  it('the production app port is loopback-only and the database publishes no host port', () => {
    const compose = read('infra/deploy/docker-compose.prod.yml');
    const postgres = compose.split('  postgres:')[1]!.split('  redis:')[0]!;
    expect(postgres).not.toMatch(/^\s+ports:/m);
    expect(compose).toMatch(/"127\.0\.0\.1:\$\{APP_PORT:-3000\}:3000"/);
    expect(read('infra/deploy/scripts/remote/setup.sh')).toContain('chmod 700 "$DEPLOY_PATH/backups" "$DEPLOY_PATH/state"');
  });

  it('admin basic-auth credentials stop at nginx and non-API hosts reject API paths as documented', () => {
    const admin = read('infra/deploy/nginx/admin.conf.template');
    expect(admin.match(/auth_basic_user_file \/etc\/nginx\/freightchain-admin\.htpasswd;/g)).toHaveLength(2);
    expect(admin.match(/proxy_set_header Authorization "";/g)).toHaveLength(2);
    for (const host of ['storybook', 'whitepaper']) expect(read(`infra/deploy/nginx/${host}.conf.template`)).toContain('location /api/ { return 404; }');
  });
});
