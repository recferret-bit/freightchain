import { EnvRulesConfigAdapter } from '../../../../src/infrastructure/config/rules-config.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

describe('EnvRulesConfigAdapter', () => {
  const base = { freeRideSeconds: 10, hbMinIntervalMs: 500, demoWallets: new Set(['d']), demoScale: 30, initialSeedLamports: 7, treasuryPubkey: 'T', appDomain: 'd.example', appOrigin: 'https://d.example', verdictEnforce: false, telemetryRetentionDays: 30, adminWallets: new Set(['A']), adminHost: null };

  it('the game rules from the environment plus the fixed timings', () => {
    expect(new EnvRulesConfigAdapter(base as unknown as EnvService).get()).toEqual({
      freeOnSignup: 5, freeRidesMax: 5, freeRideSeconds: 10, hbMinIntervalMs: 500, hbTimeoutMs: 150_000, quoteTtlMs: 600_000, nonceTtlMs: 300_000,
      demoWallets: new Set(['d']), demoScale: 30, initialSeedLamports: 7, treasury: 'T', appDomain: 'd.example', appOrigin: 'https://d.example',
      verdictEnforce: false, telemetryRetentionDays: 30, adminWallets: new Set(['A']), adminDomain: 'd.example', adminOrigin: 'https://d.example',
    });
  });

  it('split deployment: the admin sign-in names admin.<apex>', () => {
    const rules = new EnvRulesConfigAdapter({ ...base, adminHost: 'admin.d.example' } as unknown as EnvService).get();
    expect([rules.adminDomain, rules.adminOrigin]).toEqual(['admin.d.example', 'https://admin.d.example']);
  });
});
