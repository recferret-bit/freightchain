import { Keypair } from '@solana/web3.js';
import { validateEnv } from '../../../../src/infrastructure/config/env.schema.js';

const base = { DATABASE_URL: 'postgresql://x' };
const prod = { ...base, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32), TREASURY_PUBKEY: Keypair.generate().publicKey.toBase58(), TRUST_PROXY: '1' };

describe('validateEnv', () => {
  it('needs only DATABASE_URL in development and applies the defaults', () => {
    expect(validateEnv(base)).toMatchObject({ PORT: 3000, NODE_ENV: 'development', FREE_RIDE_SECONDS: 180, THROTTLE_LIMIT: 600, THROTTLE_AUTH_LIMIT: 30, DEMO_SCALE: 60, DEMO_WALLETS: '' });
    expect(validateEnv(base).TRUST_PROXY).toBeUndefined(); // dev: 0 hops by default (EnvService)
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
  it('treats KEY= (empty) as not set for optional keys', () => {
    expect(validateEnv({ ...base, JWT_SECRET: '', TREASURY_PUBKEY: '', SOL_USD: '', CLIENT_DIR: '', TRUST_PROXY: '' })).toMatchObject({ JWT_SECRET: undefined, TREASURY_PUBKEY: undefined, SOL_USD: undefined, CLIENT_DIR: undefined, TRUST_PROXY: undefined });
  });
  it('coerces numbers and rejects nonsense', () => {
    expect(validateEnv({ ...base, SOL_USD: '118.5', FREE_RIDE_SECONDS: '10', THROTTLE_AUTH_LIMIT: '2' })).toMatchObject({ SOL_USD: 118.5, FREE_RIDE_SECONDS: 10, THROTTLE_AUTH_LIMIT: 2 });
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
