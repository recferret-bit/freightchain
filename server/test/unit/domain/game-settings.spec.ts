import { assertSettingValue, resolveSettings, SETTING_DEFAULTS } from '../../../src/domain/settings/game-settings.js';
import { BadRequestError } from '../../../src/domain/shared/errors.js';

const defaults = {
  freeOnSignup: SETTING_DEFAULTS.free_on_signup,
  freeRidesDailyMax: SETTING_DEFAULTS.free_rides_daily_max,
  weeklyTicket1hEnabled: 1, weeklyTicket1hDays: 7,
  weeklyTicket4hEnabled: 0, weeklyTicket4hDays: 7,
  weeklyTicket8hEnabled: 0, weeklyTicket8hDays: 7,
  editorJobsPerDay: 40, editorMaxSteps: 24, editorMaxOutputTokens: 32_000, editorMaxInputKTokens: 500, editorJobsParallel: 5,
};

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
