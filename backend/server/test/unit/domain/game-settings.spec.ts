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

  it('the AI editor knobs: jobs per day, model turns, output tokens, jobs at once (0 pauses the AI editor)', () => {
    expect(resolveSettings([{ key: 'editor_jobs_per_day', value: 5 }, { key: 'editor_jobs_parallel', value: 0 }])).toMatchObject({ editorJobsPerDay: 5, editorJobsParallel: 0, editorMaxSteps: 24 });
  });

  it('a referral knob keeps its own bounds: the referrer part stays the bigger part, and a lamport cap fits a signed int', () => {
    expect(resolveSettings([]).referralCountWeeklyGrant).toBe(1);
    expect(resolveSettings([{ key: 'referral_count_weekly_grant', value: 0 }]).referralCountWeeklyGrant).toBe(0);
    expect(() => assertSettingValue('referral_count_weekly_grant', 2)).toThrow(BadRequestError);
    expect(() => assertSettingValue('referral_referrer_part_bps', 8000)).not.toThrow();
    expect(() => assertSettingValue('referral_referrer_part_bps', 5000)).toThrow(BadRequestError);
    expect(() => assertSettingValue('referral_ride_cap_lamports', 2_000_000_000)).not.toThrow();
    expect(() => assertSettingValue('referral_ride_cap_lamports', 2_000_000_001)).toThrow(BadRequestError);
    expect(resolveSettings([{ key: 'referral_max', value: 0 }]).referralMax).toBe(30);
  });

  it('validates operational Convoy settings and leaves immutable chain caps out of editable keys', () => {
    expect(resolveSettings([{ key: 'referral_pending_ttl_hours', value: 12 }, { key: 'referral_ten4_m1_amount', value: 75 }])).toMatchObject({ referralPendingTtlHours: 12, referralTen4M1Amount: 75 });
    for (const [key, value] of [['referral_pending_ttl_hours', 0], ['referral_ten4_m1_amount', 1001], ['referral_min_trust_referrer', 49], ['referral_referee_promo_ranked', 2], ['referral_ten4_global_monthly', 50000]] as const) expect(() => assertSettingValue(key, value)).toThrow(BadRequestError);
    expect(() => assertSettingValue('referral_referee_promo_global_week', 0)).not.toThrow();
  });

  it('zero is allowed; anything else the domain refuses is bad_setting', () => {
    expect(() => assertSettingValue('free_on_signup', 0)).not.toThrow();
    expect(() => assertSettingValue('weekly_ticket_1h_days', 7)).not.toThrow();
    expect(() => assertSettingValue('weekly_ticket_4h_enabled', 0)).not.toThrow();
    expect(() => assertSettingValue('weekly_ticket_1h_days', 0)).toThrow(BadRequestError);
    expect(() => assertSettingValue('weekly_ticket_4h_enabled', 2)).toThrow(BadRequestError);
    expect(() => assertSettingValue('weekly_ticket_tier', 1)).toThrow(BadRequestError);
    for (const [key, value] of [['nope', 1], ['free_on_signup', 100_001], ['free_on_signup', -1], ['free_on_signup', 1.5]] as const) {
      expect(() => assertSettingValue(key, value)).toThrow(BadRequestError);
      try { assertSettingValue(key, value); } catch (e) { expect(e).toMatchObject({ errorCode: 'bad_setting' }); }
    }
  });
});
