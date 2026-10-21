import { EnvTelemetryConfigAdapter } from '../../../../src/infrastructure/config/env-telemetry-config.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { validateEnv } from '../../../../src/infrastructure/config/env.schema.js';

describe('EnvTelemetryConfigAdapter', () => {
  it('defaults to off and accepts shadow', () => {
    const base = { DATABASE_URL: 'postgresql://x', NODE_ENV: 'test' };
    expect(validateEnv(base).TELEMETRY_V21).toBe('off');
    expect(validateEnv({ ...base, TELEMETRY_V21: 'shadow' }).TELEMETRY_V21).toBe('shadow');
    expect(validateEnv({ ...base, TELEMETRY_V21: 'enforce' }).TELEMETRY_V21).toBe('enforce');
  });

  it('reads the mode off EnvService', () => {
    const env = { telemetryV21: 'shadow' } as EnvService;
    expect(new EnvTelemetryConfigAdapter(env).mode()).toBe('shadow');
  });
});
