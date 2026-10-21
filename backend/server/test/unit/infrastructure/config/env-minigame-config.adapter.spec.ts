import { EnvMinigameConfigAdapter } from '../../../../src/infrastructure/config/env-minigame-config.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { validateEnv } from '../../../../src/infrastructure/config/env.schema.js';

describe('EnvMinigameConfigAdapter', () => {
  it('reads mode, salt version and secret off EnvService', () => {
    const env = { minigamesMode: 'shadow', mgSaltVersion: 'mg:v1', mgSecret: 'k'.repeat(32) } as EnvService;
    const adapter = new EnvMinigameConfigAdapter(env);
    expect(adapter.mode()).toBe('shadow');
    expect(adapter.saltVersion()).toBe('mg:v1');
    expect(adapter.secret()).toBe('k'.repeat(32));
  });

  it('defaults MINIGAMES to off and requires MG_SECRET only when the mode is live', () => {
    const base = { DATABASE_URL: 'postgresql://x', NODE_ENV: 'test' };
    expect(validateEnv(base)).toMatchObject({ MINIGAMES: 'off', MG_SALT_VERSION: 'mg:v1' });
    expect(validateEnv(base).MG_SECRET).toBeUndefined();
    expect(validateEnv({ ...base, MG_SECRET: '' }).MG_SECRET).toBeUndefined();
    expect(() => validateEnv({ ...base, MINIGAMES: 'shadow' })).toThrow(/MG_SECRET/);
    expect(validateEnv({ ...base, MINIGAMES: 'enforce', MG_SECRET: 'k'.repeat(32) }).MINIGAMES).toBe('enforce');
    expect(() => validateEnv({ ...base, MINIGAMES: 'live' })).toThrow(/MINIGAMES/);
  });
});
