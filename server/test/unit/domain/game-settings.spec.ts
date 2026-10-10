import { assertSettingValue, resolveSettings, SETTING_DEFAULTS } from '../../../src/domain/settings/game-settings.js';
import { BadRequestError } from '../../../src/domain/shared/errors.js';

const defaults = {
  freeOnSignup: SETTING_DEFAULTS.free_on_signup,
  freeRidesDailyMax: SETTING_DEFAULTS.free_rides_daily_max,
  offlineFreeRides: SETTING_DEFAULTS.offline_free_rides,
  offlineFreeRidesPerIp: SETTING_DEFAULTS.offline_free_rides_per_ip,
};

describe('game settings', () => {
  it('an empty table is the code default: 10 at signup, daily cap 5, 3 offline runs, 10 per address', () => {
    expect(resolveSettings([])).toEqual(defaults);
  });

  it('a known in-range row wins; an unknown key or an out-of-range value is ignored', () => {
    expect(resolveSettings([
      { key: 'free_on_signup', value: 7 },
      { key: 'not_a_setting', value: 1 },
      { key: 'offline_free_rides', value: 100_001 },
      { key: 'free_rides_daily_max', value: -1 },
      { key: 'offline_free_rides_per_ip', value: 1.5 },
    ])).toEqual({ ...defaults, freeOnSignup: 7 });
  });

  it('zero is allowed; anything else the domain refuses is bad_setting', () => {
    expect(() => assertSettingValue('offline_free_rides', 0)).not.toThrow();
    for (const [key, value] of [['nope', 1], ['free_on_signup', 100_001], ['free_on_signup', -1], ['free_on_signup', 1.5]] as const) {
      expect(() => assertSettingValue(key, value)).toThrow(BadRequestError);
      try { assertSettingValue(key, value); } catch (e) { expect(e).toMatchObject({ errorCode: 'bad_setting' }); }
    }
  });
});
