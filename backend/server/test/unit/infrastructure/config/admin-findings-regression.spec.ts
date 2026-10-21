import { isStrictNodeEnv, strictModeIssues, validateEnv } from '../../../../src/infrastructure/config/env.schema.js';

const safe = {
  DATABASE_URL: 'postgresql://x/db', JWT_SECRET: 'j'.repeat(40), TREASURY_PUBKEY: 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn', TRUST_PROXY: '1',
  LIVE_EFFECTS: 'off', LIVE_FREE_DONATIONS: 'off', DEMO_WALLETS: '', EDITOR_FAKE_LLM: '0',
};

describe('admin findings regression (strict startup)', () => {
  it('treats staging, production and an unset NODE_ENV as strict', () => {
    expect(isStrictNodeEnv(undefined)).toBe(true);
    expect(isStrictNodeEnv('')).toBe(true);
    expect(isStrictNodeEnv('staging')).toBe(true);
    expect(isStrictNodeEnv('production')).toBe(true);
    expect(isStrictNodeEnv('development')).toBe(false);
    expect(isStrictNodeEnv('test')).toBe(false);
  });

  it('refuses the dangerous flags on staging and on production, one key at a time', () => {
    for (const node of ['staging', 'production']) {
      expect(() => validateEnv({ ...safe, NODE_ENV: node, DEMO_WALLETS: 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn' })).toThrow(/DEMO_WALLETS/);
      expect(() => validateEnv({ ...safe, NODE_ENV: node, EDITOR_FAKE_LLM: '1' })).toThrow(/EDITOR_FAKE_LLM/);
      expect(() => validateEnv({ ...safe, NODE_ENV: node, LIVE_FREE_DONATIONS: 'on' })).toThrow(/LIVE_FREE_DONATIONS/);
      expect(() => validateEnv({ ...safe, NODE_ENV: node, LIVE_EFFECTS: 'free' })).toThrow(/LIVE_EFFECTS/);
      expect(() => validateEnv({ ...safe, NODE_ENV: node })).not.toThrow();
    }
    // An omitted NODE_ENV is the schema default `development`, which is not strict. An explicit staging process is.
    expect(validateEnv({ DATABASE_URL: 'postgresql://x/db' }).NODE_ENV).toBe('development');
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://x/db', NODE_ENV: 'staging' })).toThrow(/LIVE_EFFECTS/);
  });

  it('refuses equal session secrets when they are set', () => {
    const env = validateEnv({ ...safe, NODE_ENV: 'development' });
    expect(strictModeIssues({ ...env, ADMIN_JWT_SECRET: 'a'.repeat(32), JWT_SECRET: 'a'.repeat(32), EDITOR_JWT_SECRET: 'e'.repeat(32) }).join('\n')).toMatch(/ADMIN_JWT_SECRET/);
  });
});
