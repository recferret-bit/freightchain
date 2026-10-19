import { EnvPrizeGeoAdapter, prizeGeoFromEnv } from '../../../../src/infrastructure/prize/env-prize-geo.adapter.js';
import { BLOCKED_US_STATES, PRIZE_BLOCKED_COUNTRIES, SANCTIONED_COUNTRIES } from '../../../../src/domain/prize/prize-rules.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

describe('EnvPrizeGeoAdapter', () => {
  it('empty strings keep the code defaults; a list replaces that one list', () => {
    expect(prizeGeoFromEnv('', '', '')).toEqual({
      sanctionedCountries: SANCTIONED_COUNTRIES,
      prizeBlockedCountries: PRIZE_BLOCKED_COUNTRIES,
      blockedUsStates: BLOCKED_US_STATES,
    });
    expect(prizeGeoFromEnv('kp, ir', '', 'ca')).toMatchObject({ sanctionedCountries: ['KP', 'IR'], blockedUsStates: ['CA'] });
    const env = { prizeSanctionedCountries: '', prizeBlockedCountries: 'GB', prizeBlockedUsStates: '' } as EnvService;
    expect(new EnvPrizeGeoAdapter(env).rules().prizeBlockedCountries).toEqual(['GB']);
  });
});
