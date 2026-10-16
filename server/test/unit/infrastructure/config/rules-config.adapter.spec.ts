import { EnvRulesConfigAdapter } from '../../../../src/infrastructure/config/rules-config.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

const env = (over: Record<string, unknown> = {}) => ({
  freeRideSeconds: 10, hbMinIntervalMs: 500, demoWallets: new Set(['d']), demoScale: 30, initialSeedLamports: 7, treasuryPubkey: 'T', appDomain: 'd.example', appOrigin: 'https://d.example',
  trafficProofRequired: true, verdictEnforce: false, telemetryRetentionDays: 30, adminWallets: new Set(['A']), adminHost: null, gameHost: null, editorWallets: new Set(['E']), editorHost: null, editorJobTimeoutMs: 600_000, hbTimeoutMs: 150_000, liveFlags: { chat: 'free', donations: true, freeDonations: false, effects: 'off' },
  paymentMode: 'transfer', ticketProgramId: '', feeTreasury: '', seedTreasury: '', watchIntervalMs: 15_000, orderTtlMs: 3_600_000, solanaCommitment: 'confirmed',
  crankSecret: undefined, priorityFee: { percentile: 75, minMicrolamports: 0, maxMicrolamports: 50_000 }, onchainSessionTtlHours: 24,
  signInRetentionDays: 180,
  ...over,
}) as unknown as EnvService;

describe('EnvRulesConfigAdapter', () => {
  it('the game rules from the environment plus the fixed timings', () => {
    expect(new EnvRulesConfigAdapter(env()).get()).toEqual({
      freeOnSignup: 5, freeRidesMax: 5, freeRideSeconds: 10, hbMinIntervalMs: 500, hbTimeoutMs: 150_000, quoteTtlMs: 600_000, nonceTtlMs: 300_000,
      demoWallets: new Set(['d']), demoScale: 30, initialSeedLamports: 7, treasury: 'T', appDomain: 'd.example', appOrigin: 'https://d.example', gameDomain: null, gameOrigin: null, live: { chat: 'free', donations: true, freeDonations: false, effects: 'off' },
      trafficProofRequired: true, verdictEnforce: false, telemetryRetentionDays: 30, signInRetentionDays: 180, adminWallets: new Set(['A']), adminDomain: 'd.example', adminOrigin: 'https://d.example',
      editorWallets: new Set(['E']), editorDomain: 'd.example', editorOrigin: 'https://d.example', editorJobTimeoutMs: 600_000,
      paymentMode: 'transfer', programId: '', feeTreasury: '', seedTreasury: '', watchIntervalMs: 15_000, orderTtlMs: 3_600_000, commitment: 'confirmed',
      crankEnabled: false, priorityFee: { percentile: 75, minMicrolamports: 0, maxMicrolamports: 50_000 }, sessionTtlHours: 24,
    });
  });

  it('the ticket settings follow the environment; the crank is only a flag, the secret key never enters the rules', () => {
    const rules = new EnvRulesConfigAdapter(env({ paymentMode: 'program', ticketProgramId: 'PROG', feeTreasury: 'F', seedTreasury: 'S', crankSecret: 'crank-secret', solanaCommitment: 'finalized' })).get();
    expect(rules).toMatchObject({ paymentMode: 'program', programId: 'PROG', feeTreasury: 'F', seedTreasury: 'S', crankEnabled: true, commitment: 'finalized' });
    expect(JSON.stringify(rules)).not.toMatch(/crank-secret/);
  });

  it('split deployment: the admin sign-in names admin.<apex>, a sign-in from the game host names ride.<apex>, the editor storybook.<apex>', () => {
    const rules = new EnvRulesConfigAdapter(env({ adminHost: 'admin.d.example', gameHost: 'ride.d.example', editorHost: 'storybook.d.example' })).get();
    expect([rules.editorDomain, rules.editorOrigin]).toEqual(['storybook.d.example', 'https://storybook.d.example']);
    expect([rules.adminDomain, rules.adminOrigin]).toEqual(['admin.d.example', 'https://admin.d.example']);
    expect([rules.gameDomain, rules.gameOrigin]).toEqual(['ride.d.example', 'https://ride.d.example']);
  });
});
