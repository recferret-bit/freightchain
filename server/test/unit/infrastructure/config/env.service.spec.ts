import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Keypair } from '@solana/web3.js';
import { Logger } from '@nestjs/common';
import { EnvService } from '../../../../src/infrastructure/config/env.service.js';

/** EnvService validates process.env when it is CREATED – each app instance sees the environment as it is then. */
const withEnv = (vars: Record<string, string | undefined>) => {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return new EnvService(); } finally { process.env = saved; }
};

describe('EnvService', () => {
  const base = { DATABASE_URL: 'postgresql://x/db', NODE_ENV: 'development', JWT_SECRET: undefined, TREASURY_PUBKEY: undefined, DEMO_WALLETS: undefined, TRUST_PROXY: undefined, CLIENT_DIR: undefined, COOKIE_DOMAIN: undefined, CORS_ORIGINS: undefined, POSTHOG_KEY: undefined, POSTHOG_HOST: undefined, POSTHOG_DISABLED: undefined, POSTHOG_PROJECT_ID: undefined };

  it('reads the environment at construction (a later change does not leak into an existing instance)', () => {
    const a = withEnv({ ...base, FREE_RIDE_SECONDS: '10' });
    const b = withEnv({ ...base, FREE_RIDE_SECONDS: '20' });
    expect([a.freeRideSeconds, b.freeRideSeconds]).toEqual([10, 20]);
  });

  it('without JWT_SECRET: a random secret per instance (never a constant), stable within the instance', () => {
    const a = withEnv(base), b = withEnv(base);
    expect(a.jwtSecret).toHaveLength(64);
    expect(a.jwtSecret).toBe(a.jwtSecret);
    expect(a.jwtSecret).not.toBe(b.jwtSecret);
    expect(withEnv({ ...base, JWT_SECRET: 'z'.repeat(40) }).jwtSecret).toBe('z'.repeat(40));
  });

  it('demo wallets, lamport seed, defaults for trust proxy and the client folder', () => {
    const env = withEnv({ ...base, DEMO_WALLETS: ' a , b ,', INITIAL_SEED_SOL: '0.5' });
    expect([...env.demoWallets]).toEqual(['a', 'b']);
    expect(env.initialSeedLamports).toBe(500_000_000);
    expect(env.trustProxy).toBe(0);
    expect(env.clientDir).toMatch(/[\\/]client$/);
    expect(withEnv({ ...base, CLIENT_DIR: '/srv/site' }).clientDir).toBe('/srv/site');
    expect(env.landingDir).toMatch(/[\\/]landing[\\/]dist$/);
    expect(withEnv({ ...base, LANDING_DIR: '/srv/landing' }).landingDir).toBe('/srv/landing');
  });

  it('split deployment: cookie domain and the CORS origin allowlist (trimmed, no trailing slash); both off by default', () => {
    const off = withEnv(base);
    expect([off.cookieDomain, off.corsOrigins]).toEqual([undefined, []]);
    const on = withEnv({ ...base, COOKIE_DOMAIN: 'freightchain.fun', CORS_ORIGINS: ' https://freightchain.fun/ , https://ride.freightchain.fun ,' });
    expect([on.cookieDomain, on.corsOrigins]).toEqual(['freightchain.fun', ['https://freightchain.fun', 'https://ride.freightchain.fun']]);
  });

  it('treasury: the env value, else – in development only – data/treasury.json, else none', () => {
    expect(withEnv({ ...base, TREASURY_PUBKEY: '11111111111111111111111111111111' }).treasuryPubkey).toBe('11111111111111111111111111111111');
    expect(withEnv({ ...base, NODE_ENV: 'test' }).treasuryPubkey).toBe('');
  });

  describe('the dev treasury file (data/treasury.json, outside production and tests)', () => {
    const inDirWith = (content: string | null, vars: Record<string, string | undefined>) => {
      const dir = mkdtempSync(join(tmpdir(), 'fc-env-'));
      if (content !== null) { mkdirSync(join(dir, 'data')); writeFileSync(join(dir, 'data', 'treasury.json'), content); }
      const cwd = process.cwd();
      process.chdir(dir);
      try { return withEnv(vars); } finally { process.chdir(cwd); }
    };
    it('a valid key is used', () => {
      const key = Keypair.generate().publicKey.toBase58();
      expect(inDirWith(JSON.stringify({ publicKey: key }), base).treasuryPubkey).toBe(key);
    });
    it('a file with an invalid key stops the boot (it used to surface as a 500 at the first payment)', () => {
      expect(() => inDirWith(JSON.stringify({ publicKey: 'abc' }), base)).toThrow(/not a base58 Solana address/);
    });
    it('a missing or empty key is off; a non-token logs once and stays off; the kill switch is explicit', () => {
      expect(withEnv(base).analyticsEnabled).toBe(false);
      expect(withEnv({ ...base, POSTHOG_KEY: '' }).posthogKey).toBeNull();
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const bad = withEnv({ ...base, NODE_ENV: 'test', POSTHOG_KEY: 'phx_pasted' });
      expect(bad.posthogKey).toBeNull();
      expect(bad.posthogKey).toBeNull();
      expect(bad.analyticsEnabled).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toBe('analytics disabled: POSTHOG_KEY is not a project token');
      expect(String(warn.mock.calls[0]?.[0])).not.toContain('phx_pasted');
      warn.mockRestore();
      const on = withEnv({ ...base, POSTHOG_KEY: 'phc_abc123', POSTHOG_DISABLED: 'false', POSTHOG_PROJECT_ID: '42' });
      expect(on.analyticsEnabled).toBe(true);
      expect(on.posthogDisabled).toBe(false);
      expect(on.posthogHost).toBe('https://us.i.posthog.com');
      expect(on.posthogProjectId).toBe('42');
      expect(withEnv({ ...base, POSTHOG_KEY: 'phc_abc123', POSTHOG_DISABLED: '0' }).analyticsEnabled).toBe(true);
      expect(withEnv({ ...base, POSTHOG_KEY: 'phc_abc123', POSTHOG_DISABLED: 'true' }).analyticsEnabled).toBe(false);
      expect(withEnv({ ...base, POSTHOG_KEY: 'phc_abc123', POSTHOG_DISABLED: '1' }).analyticsEnabled).toBe(false);
      expect(withEnv({ ...base, POSTHOG_HOST: 'https://eu.i.posthog.com/' }).posthogHost).toBe('https://eu.i.posthog.com/');
    });

    it('no file: paid rides are off; tests and production never read it', () => {
      expect(inDirWith(null, base).treasuryPubkey).toBe('');
      expect(inDirWith(JSON.stringify({ publicKey: 'abc' }), { ...base, NODE_ENV: 'test' }).treasuryPubkey).toBe('');
    });
  });
});
