import { Keypair } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { validateEnv } from '../../../../src/infrastructure/config/env.schema.js';

const base = { DATABASE_URL: 'postgresql://x' };
const prod = { ...base, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32), TREASURY_PUBKEY: Keypair.generate().publicKey.toBase58(), TRUST_PROXY: '1' };

describe('validateEnv', () => {
  it('the deployed worker supplies the explicit production proxy setting required by its CLI EnvModule', () => {
    const compose = readFileSync(new URL('../../../../../deploy/docker-compose.prod.yml', import.meta.url), 'utf8');
    const worker = compose.split('\n  worker:\n')[1]!.split('\nnetworks:')[0]!;
    const setting = (key: string) => worker.match(new RegExp(`^      ${key}: ["']?([^"'\\s#]+)`, 'm'))?.[1];
    expect(validateEnv({ ...prod, NODE_ENV: setting('NODE_ENV'), TRUST_PROXY: setting('TRUST_PROXY') })).toMatchObject({ NODE_ENV: 'production', TRUST_PROXY: 0 });
  });
  it('needs only DATABASE_URL in development and applies the defaults', () => {
    expect(validateEnv(base)).toMatchObject({
      PORT: 3000,
      NODE_ENV: 'development',
      FREE_RIDE_SECONDS: 180,
      TRAFFIC_PROOF_REQUIRED: true,
      CHALLENGE_FREE_RIDES: 'on',
      THROTTLE_LIMIT: 600,
      THROTTLE_AUTH_LIMIT: 30,
      DEMO_SCALE: 60,
      DEMO_WALLETS: '',
      SNS_RPC: 'https://api.mainnet-beta.solana.com',
      SNS_RPC_FALLBACKS: '',
      SNS_CACHE_TTL_SECONDS: 86400,
      SNS_NEGATIVE_CACHE_TTL_SECONDS: 1800,
    });
    expect(validateEnv(base).TRUST_PROXY).toBeUndefined(); // dev: 0 hops by default (EnvService)
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
  it('treats KEY= (empty) as not set for optional keys', () => {
    expect(validateEnv({ ...base, JWT_SECRET: '', TREASURY_PUBKEY: '', SOL_USD: '', CLIENT_DIR: '', TRUST_PROXY: '', POSTHOG_KEY: '', POSTHOG_HOST: '', POSTHOG_ENABLED: '', POSTHOG_DISABLED: '', POSTHOG_PROJECT_ID: '' })).toMatchObject({ JWT_SECRET: undefined, TREASURY_PUBKEY: undefined, SOL_USD: undefined, CLIENT_DIR: undefined, TRUST_PROXY: undefined, POSTHOG_KEY: undefined, POSTHOG_HOST: 'https://eu.i.posthog.com', POSTHOG_ENABLED: undefined, POSTHOG_DISABLED: undefined, POSTHOG_PROJECT_ID: undefined });
  });
  it('POSTHOG_ENABLED and POSTHOG_DISABLED are enums, not coerced booleans, and a non-token key does not fail the schema', () => {
    expect(validateEnv({ ...base, POSTHOG_ENABLED: 'false', POSTHOG_DISABLED: '0', POSTHOG_KEY: 'not-a-token' })).toMatchObject({ POSTHOG_ENABLED: 'false', POSTHOG_DISABLED: '0', POSTHOG_KEY: 'not-a-token' });
    expect(validateEnv({ ...base, POSTHOG_ENABLED: '1', POSTHOG_DISABLED: 'true' })).toMatchObject({ POSTHOG_ENABLED: '1', POSTHOG_DISABLED: 'true' });
    expect(() => validateEnv({ ...base, POSTHOG_ENABLED: 'yes' })).toThrow(/POSTHOG_ENABLED/);
    expect(() => validateEnv({ ...base, POSTHOG_DISABLED: 'yes' })).toThrow(/POSTHOG_DISABLED/);
  });
  it('coerces numbers and rejects nonsense', () => {
    expect(validateEnv({ ...base, SOL_USD: '118.5', FREE_RIDE_SECONDS: '10', THROTTLE_AUTH_LIMIT: '2', SNS_CACHE_TTL_SECONDS: '3600', SNS_NEGATIVE_CACHE_TTL_SECONDS: '600' })).toMatchObject({ SOL_USD: 118.5, FREE_RIDE_SECONDS: 10, THROTTLE_AUTH_LIMIT: 2, SNS_CACHE_TTL_SECONDS: 3600, SNS_NEGATIVE_CACHE_TTL_SECONDS: 600 });
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...base, TREASURY_PUBKEY: 'not-an-address' })).toThrow(/TREASURY_PUBKEY/);
  });
  it('COOKIE_DOMAIN is a bare host name', () => {
    expect(validateEnv({ ...base, COOKIE_DOMAIN: 'freightchain.fun' }).COOKIE_DOMAIN).toBe('freightchain.fun');
    expect(validateEnv({ ...base, COOKIE_DOMAIN: '' }).COOKIE_DOMAIN).toBeUndefined();
    expect(() => validateEnv({ ...base, COOKIE_DOMAIN: 'https://freightchain.fun' })).toThrow(/COOKIE_DOMAIN/);
  });
  it('accepts what the old config accepted: SOL_USD=0 (= not pinned) and any NODE_ENV', () => {
    expect(validateEnv({ ...base, SOL_USD: '0' }).SOL_USD).toBe(0);
    expect(validateEnv({ ...base, NODE_ENV: 'staging' }).NODE_ENV).toBe('staging');
  });

  it('production REQUIRES JWT_SECRET (>= 32 chars), TREASURY_PUBKEY and an explicit TRUST_PROXY (0 is fine)', () => {
    expect(validateEnv(prod).NODE_ENV).toBe('production');
    expect(validateEnv({ ...prod, TRUST_PROXY: '0' }).TRUST_PROXY).toBe(0);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/JWT_SECRET[\s\S]*TREASURY_PUBKEY[\s\S]*TRUST_PROXY/);
    expect(() => validateEnv({ ...prod, JWT_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => validateEnv({ ...prod, TRUST_PROXY: undefined })).toThrow(/TRUST_PROXY/);
  });
});

describe('validateEnv – paid tickets (all optional until the workstreams need them)', () => {
  const addr = Keypair.generate().publicKey.toBase58();
  it('applies the defaults and needs none of the new keys, in production too', () => {
    expect(validateEnv(base)).toMatchObject({ SOLANA_COMMITMENT: 'confirmed', WATCH_INTERVAL_MS: 15_000, PRIORITY_FEE_PERCENTILE: 75, PRIORITY_FEE_MIN_MICROLAMPORTS: 0, PRIORITY_FEE_MAX_MICROLAMPORTS: 50_000, ORDER_TTL_MINUTES: 60, ONCHAIN_SESSION_TTL_HOURS: 24, SOLANA_RPC_FALLBACKS: '' });
    expect(() => validateEnv(prod)).not.toThrow(); // today's live deploy keeps booting
  });
  it('program id and treasuries must be base58 addresses; empty values count as unset', () => {
    expect(validateEnv({ ...base, TICKET_PROGRAM_ID: addr, FEE_TREASURY: addr, SEED_TREASURY: addr })).toMatchObject({ TICKET_PROGRAM_ID: addr });
    expect(validateEnv({ ...base, TICKET_PROGRAM_ID: '', FEE_TREASURY: '' })).toMatchObject({ TICKET_PROGRAM_ID: undefined, FEE_TREASURY: undefined });
    for (const key of ['TICKET_PROGRAM_ID', 'FEE_TREASURY', 'SEED_TREASURY']) expect(() => validateEnv({ ...base, [key]: 'nope' }), key).toThrow(new RegExp(`${key} must be a base58`));
  });
  it('PAYMENT_MODE=program needs the program id; unknown modes and bad numbers are rejected', () => {
    expect(() => validateEnv({ ...base, PAYMENT_MODE: 'program' })).toThrow(/TICKET_PROGRAM_ID must be set/);
    expect(() => validateEnv({ ...base, PAYMENT_MODE: 'program', TICKET_PROGRAM_ID: addr })).not.toThrow();
    expect(() => validateEnv({ ...base, PAYMENT_MODE: 'escrow' })).toThrow(/PAYMENT_MODE/);
    expect(() => validateEnv({ ...base, SOLANA_COMMITMENT: 'processed' })).toThrow(/SOLANA_COMMITMENT/);
    expect(() => validateEnv({ ...base, PRIORITY_FEE_PERCENTILE: '100' })).toThrow(/PRIORITY_FEE_PERCENTILE/);
    expect(() => validateEnv({ ...base, ONCHAIN_SESSION_TTL_HOURS: '500' })).toThrow(/ONCHAIN_SESSION_TTL_HOURS/);
  });
  it('the priority-fee floor may not exceed the ceiling; secrets must look like secrets', () => {
    expect(() => validateEnv({ ...base, PRIORITY_FEE_MIN_MICROLAMPORTS: '9000', PRIORITY_FEE_MAX_MICROLAMPORTS: '100' })).toThrow(/must not exceed/);
    expect(() => validateEnv({ ...base, WEBHOOK_SECRET: 'short' })).toThrow(/WEBHOOK_SECRET/);
    expect(() => validateEnv({ ...base, CRANK_SECRET: 'short' })).toThrow(/CRANK_SECRET/);
    expect(validateEnv({ ...base, WEBHOOK_SECRET: '', CRANK_SECRET: '' })).toMatchObject({ WEBHOOK_SECRET: undefined, CRANK_SECRET: undefined });
    // the gas sponsor is gone: a FEE_PAYER_SECRET left in an old env file is ignored, it neither refuses the boot nor is it read
    expect(() => validateEnv({ ...base, FEE_PAYER_SECRET: 'short' })).not.toThrow();
  });

  it('EDITOR_WALLETS are base58 addresses and EDITOR_IP_ALLOWLIST IPs / CIDRs; both default to empty', () => {
    const base = { DATABASE_URL: 'postgresql://x/y' };
    expect(validateEnv(base)).toMatchObject({ EDITOR_WALLETS: '', EDITOR_IP_ALLOWLIST: '', EDITOR_SESSION_TTL_MINUTES: 240, THROTTLE_ENTITIES_LIMIT: 120, THROTTLE_EDITOR_LIMIT: 240, THROTTLE_ENTITIES_RPS: 5, THROTTLE_EDITOR_RPS: 10, THROTTLE_AUTH_RPS: 5, THROTTLE_MCP_LIMIT: 600, THROTTLE_MCP_RPS: 20 });
    expect(() => validateEnv({ ...base, EDITOR_WALLETS: 'not-a-wallet' })).toThrow(/EDITOR_WALLETS/);
    expect(() => validateEnv({ ...base, EDITOR_IP_ALLOWLIST: '10.0.0.0/8, nonsense' })).toThrow(/EDITOR_IP_ALLOWLIST.*nonsense/);
    expect(validateEnv({ ...base, EDITOR_IP_ALLOWLIST: '10.0.0.0/8, ::1' }).EDITOR_IP_ALLOWLIST).toBe('10.0.0.0/8, ::1');
  });

  it('the AI editor: keys are optional, the MCP token ≥ 24 chars, a known default provider, the job timeout bounded, the fake never in production', () => {
    const base = { DATABASE_URL: 'postgresql://x/y' };
    expect(validateEnv(base)).toMatchObject({ EDITOR_MCP_URL: 'http://127.0.0.1:3100', EDITOR_JOB_TIMEOUT_MS: 600_000, ZAI_BASE_URL: 'https://api.z.ai/api/paas/v4', EDITOR_FAKE_LLM: '0' });
    expect(validateEnv({ ...base, ANTHROPIC_API_KEY: '' }).ANTHROPIC_API_KEY).toBeUndefined();
    expect(() => validateEnv({ ...base, EDITOR_MCP_TOKEN: 'short' })).toThrow(/EDITOR_MCP_TOKEN/);
    expect(() => validateEnv({ ...base, EDITOR_DEFAULT_PROVIDER: 'mistral' })).toThrow(/EDITOR_DEFAULT_PROVIDER/);
    expect(() => validateEnv({ ...base, EDITOR_JOB_TIMEOUT_MS: '500' })).toThrow(/EDITOR_JOB_TIMEOUT_MS/);
    expect(validateEnv({ ...base, EDITOR_FAKE_LLM: '1' }).EDITOR_FAKE_LLM).toBe('1');
    expect(validateEnv({ ...base, EDITOR_OPEN: '1' }).EDITOR_OPEN).toBe('1');
    expect(() => validateEnv({ ...prod, EDITOR_OPEN: '1' })).toThrow(/EDITOR_OPEN/);
  });

  it('production with editor or admin wallets needs COOKIE_DOMAIN (the host walls); without wallets it may be unset', () => {
    const w = Keypair.generate().publicKey.toBase58();
    expect(() => validateEnv({ ...prod, EDITOR_WALLETS: w })).toThrow(/COOKIE_DOMAIN/);
    expect(() => validateEnv({ ...prod, ADMIN_WALLETS: w })).toThrow(/COOKIE_DOMAIN/);
    expect(validateEnv({ ...prod, EDITOR_WALLETS: w, COOKIE_DOMAIN: 'freightchain.fun' }).EDITOR_WALLETS).toBe(w);
    const token = 'x'.repeat(24);
    expect(() => validateEnv({ ...prod, EDITOR_WALLETS: w, COOKIE_DOMAIN: 'freightchain.fun', EDITOR_MCP_TOKEN: token, EDITOR_MCP_URL: 'http://169.254.169.254' })).toThrow(/EDITOR_MCP_URL/);
    expect(() => validateEnv({ ...prod, EDITOR_MCP_TOKEN: token })).toThrow(/REDIS_URL/);
    expect(validateEnv({ ...prod, REDIS_URL: 'redis://redis:6379', EDITOR_WALLETS: w, COOKIE_DOMAIN: 'freightchain.fun', EDITOR_MCP_TOKEN: token, EDITOR_MCP_URL: 'http://mcp:3100' }).EDITOR_MCP_URL).toBe('http://mcp:3100');
    expect(validateEnv(prod).NODE_ENV).toBe('production');
  });
});
