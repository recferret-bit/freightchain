import type { PaidTierId } from '../rides/ride-tier.js';
import { BadRequestError } from '../shared/errors.js';

/** Owner-tweakable integers in `player.GameSetting`. A missing or out-of-range row falls back to the code default. */
export const SETTING_KEYS = [
  'free_on_signup', 'free_rides_daily_max',
  'weekly_ticket_1h_enabled', 'weekly_ticket_1h_days',
  'weekly_ticket_4h_enabled', 'weekly_ticket_4h_days',
  'weekly_ticket_8h_enabled', 'weekly_ticket_8h_days',
  'editor_jobs_per_day', 'editor_max_steps', 'editor_max_output_tokens', 'editor_max_input_ktokens', 'editor_jobs_parallel',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_DEFAULTS: Record<SettingKey, number> = {
  free_on_signup: 10,
  free_rides_daily_max: 5,
  weekly_ticket_1h_enabled: 1, // 0 off, 1 on. Default grant is the 1h shift.
  weekly_ticket_1h_days: 7, // one 1h ticket per wallet per interval. 7 lands on prize weeks.
  weekly_ticket_4h_enabled: 0,
  weekly_ticket_4h_days: 7,
  weekly_ticket_8h_enabled: 0,
  weekly_ticket_8h_days: 7,
  editor_jobs_per_day: 40,   // AI model-editor jobs per editor wallet per UTC day
  editor_max_steps: 24,   // model turns per job (each may call tools)
  editor_max_output_tokens: 32_000,   // cumulative output tokens per job
  editor_max_input_ktokens: 500,   // input tokens per job, in thousands (every turn re-sends the history: the cost cap)
  editor_jobs_parallel: 5,   // jobs running at once across all app replicas (0 = the AI editor paused)
};

export const SETTING_MIN = 0;
export const SETTING_MAX = 100_000;
/** An admin adjust may not push a wallet past this. The daily cap is separate and never confiscates a surplus. */
export const FREE_RIDES_HARD_MAX = 100_000;

const GRANT_FLAGS = ['weekly_ticket_1h_enabled', 'weekly_ticket_4h_enabled', 'weekly_ticket_8h_enabled'] as const;
const GRANT_DAYS = ['weekly_ticket_1h_days', 'weekly_ticket_4h_days', 'weekly_ticket_8h_days'] as const;

/** The resolved knobs the rest of the server reads. Camel case on the wire (`GET /api/admin/settings`). */
export interface GameSettings {
  freeOnSignup: number;
  freeRidesDailyMax: number;
  /** 0 or 1. The 1h granted ticket. */
  weeklyTicket1hEnabled: number;
  /** Days between 1h grants. At least 1. */
  weeklyTicket1hDays: number;
  weeklyTicket4hEnabled: number;
  weeklyTicket4hDays: number;
  weeklyTicket8hEnabled: number;
  weeklyTicket8hDays: number;
  editorJobsPerDay: number;
  editorMaxSteps: number;
  editorMaxOutputTokens: number;
  editorMaxInputKTokens: number;
  editorJobsParallel: number;
}

const CAMEL: Record<SettingKey, keyof GameSettings> = {
  free_on_signup: 'freeOnSignup',
  free_rides_daily_max: 'freeRidesDailyMax',
  weekly_ticket_1h_enabled: 'weeklyTicket1hEnabled',
  weekly_ticket_1h_days: 'weeklyTicket1hDays',
  weekly_ticket_4h_enabled: 'weeklyTicket4hEnabled',
  weekly_ticket_4h_days: 'weeklyTicket4hDays',
  weekly_ticket_8h_enabled: 'weeklyTicket8hEnabled',
  weekly_ticket_8h_days: 'weeklyTicket8hDays',
  editor_jobs_per_day: 'editorJobsPerDay',
  editor_max_steps: 'editorMaxSteps',
  editor_max_output_tokens: 'editorMaxOutputTokens',
  editor_max_input_ktokens: 'editorMaxInputKTokens',
  editor_jobs_parallel: 'editorJobsParallel',
};

export const isSettingKey = (key: string): key is SettingKey => (SETTING_KEYS as readonly string[]).includes(key);

const inBounds = (n: number): boolean => Number.isInteger(n) && n >= SETTING_MIN && n <= SETTING_MAX;
const isFlag = (key: SettingKey): boolean => (GRANT_FLAGS as readonly string[]).includes(key);
const isInterval = (key: SettingKey): boolean => (GRANT_DAYS as readonly string[]).includes(key);

/** Flags are 0 or 1. Intervals are whole days, at least 1. Everything else is 0..100_000. */
export function settingAccepted(key: SettingKey, value: number): boolean {
  if (!inBounds(value)) return false;
  if (isFlag(key)) return value === 0 || value === 1;
  if (isInterval(key)) return value >= 1;
  return true;
}

/** Whether this tier's grant is on, and how many UTC days sit between grants. */
export function tierGrant(settings: GameSettings, tier: PaidTierId): { enabled: boolean; days: number } {
  if (tier === '4h') return { enabled: settings.weeklyTicket4hEnabled === 1, days: settings.weeklyTicket4hDays };
  if (tier === '8h') return { enabled: settings.weeklyTicket8hEnabled === 1, days: settings.weeklyTicket8hDays };
  return { enabled: settings.weeklyTicket1hEnabled === 1, days: settings.weeklyTicket1hDays };
}

/** Fill every knob. Unknown keys are ignored. A stored value outside its range is ignored (the code default stands). */
export function resolveSettings(rows: readonly { key: string; value: number }[]): GameSettings {
  const out = {} as GameSettings;
  for (const key of SETTING_KEYS) out[CAMEL[key]] = SETTING_DEFAULTS[key];
  for (const row of rows) {
    if (!isSettingKey(row.key) || !settingAccepted(row.key, row.value)) continue;
    out[CAMEL[row.key]] = row.value;
  }
  return out;
}

/** Unknown key or a value outside its range. Called before a signature is issued or spent. */
export function assertSettingValue(key: string, value: number): asserts key is SettingKey {
  if (!isSettingKey(key) || !settingAccepted(key, value)) throw new BadRequestError('unknown setting or value out of range', 'bad_setting');
}
