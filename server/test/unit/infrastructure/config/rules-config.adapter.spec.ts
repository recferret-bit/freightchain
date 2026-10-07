import { EnvRulesConfigAdapter } from '../../../../src/infrastructure/config/rules-config.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

describe('EnvRulesConfigAdapter', () => {
  it('the game rules from the environment plus the fixed timings', () => {
    const env = { freeRideSeconds: 10, hbMinIntervalMs: 500, demoWallets: new Set(['d']), demoScale: 30, initialSeedLamports: 7, treasuryPubkey: 'T', appDomain: 'd.example', appOrigin: 'https://d.example' } as unknown as EnvService;
    expect(new EnvRulesConfigAdapter(env).get()).toEqual({
      freeOnSignup: 5, freeRideSeconds: 10, hbMinIntervalMs: 500, hbTimeoutMs: 150_000, quoteTtlMs: 600_000, nonceTtlMs: 300_000,
      demoWallets: new Set(['d']), demoScale: 30, initialSeedLamports: 7, treasury: 'T', appDomain: 'd.example', appOrigin: 'https://d.example',
    });
  });
});
