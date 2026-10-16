import { assertSettingValue, resolveSettings } from '../../../src/domain/settings/game-settings.js';
import { BadRequestError } from '../../../src/domain/shared/errors.js';

const defaults = resolveSettings([]);

describe('game settings', () => {
  it('an empty table is the code default: 10 at signup, daily cap 5', () => {
    expect(resolveSettings([])).toEqual(defaults);
  });

  it('a known in-range row wins; an unknown key or an out-of-range value is ignored', () => {
    expect(resolveSettings([
      { key: 'free_on_signup', value: 7 },
      { key: 'not_a_setting', value: 1 },
      { key: 'free_rides_daily_max', value: -1 },
    ])).toEqual({ ...defaults, freeOnSignup: 7 });
  });

  it('a referral knob keeps its own bounds: the referrer part stays the bigger part, and a lamport cap fits a signed int', () => {
    expect(() => assertSettingValue('referral_referrer_part_bps', 8000)).not.toThrow();
    expect(() => assertSettingValue('referral_referrer_part_bps', 5000)).toThrow(BadRequestError);
    expect(() => assertSettingValue('referral_ride_cap_lamports', 2_000_000_000)).not.toThrow();
    expect(() => assertSettingValue('referral_ride_cap_lamports', 2_000_000_001)).toThrow(BadRequestError);
    expect(resolveSettings([{ key: 'referral_max', value: 0 }]).referralMax).toBe(30);
  });

  it('zero is allowed; anything else the domain refuses is bad_setting', () => {
    expect(() => assertSettingValue('free_on_signup', 0)).not.toThrow();
    for (const [key, value] of [['nope', 1], ['free_on_signup', 100_001], ['free_on_signup', -1], ['free_on_signup', 1.5]] as const) {
      expect(() => assertSettingValue(key, value)).toThrow(BadRequestError);
      try { assertSettingValue(key, value); } catch (e) { expect(e).toMatchObject({ errorCode: 'bad_setting' }); }
    }
  });
});
