import { BadRequestError } from '../shared/errors.js';

/** Owner-tweakable integers in `player.GameSetting`. A missing or out-of-range row falls back to the code default. */
export const SETTING_KEYS = ['free_on_signup', 'free_rides_daily_max', 'editor_jobs_per_day', 'editor_max_steps', 'editor_max_output_tokens', 'editor_jobs_parallel'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_DEFAULTS: Record<SettingKey, number> = {
  free_on_signup: 10,
  free_rides_daily_max: 5,
  editor_jobs_per_day: 40,   // AI model-editor jobs per editor wallet per UTC day
  editor_max_steps: 24,   // model turns per job (each may call tools)
  editor_max_output_tokens: 32_000,   // per model turn
  editor_jobs_parallel: 2,   // jobs running at once in the app (0 = the AI editor paused)
};

export const SETTING_MIN = 0;
export const SETTING_MAX = 100_000;
/** An admin adjust may not push a wallet past this. The daily cap is separate and never confiscates a surplus. */
export const FREE_RIDES_HARD_MAX = 100_000;

/** The resolved knobs the rest of the server reads. Camel case on the wire (`GET /api/admin/settings`). */
export interface GameSettings {
  freeOnSignup: number;
  freeRidesDailyMax: number;
  editorJobsPerDay: number;
  editorMaxSteps: number;
  editorMaxOutputTokens: number;
  editorJobsParallel: number;
}

const CAMEL: Record<SettingKey, keyof GameSettings> = {
  free_on_signup: 'freeOnSignup',
  free_rides_daily_max: 'freeRidesDailyMax',
  editor_jobs_per_day: 'editorJobsPerDay',
  editor_max_steps: 'editorMaxSteps',
  editor_max_output_tokens: 'editorMaxOutputTokens',
  editor_jobs_parallel: 'editorJobsParallel',
};

export const isSettingKey = (key: string): key is SettingKey => (SETTING_KEYS as readonly string[]).includes(key);

const inBounds = (n: number): boolean => Number.isInteger(n) && n >= SETTING_MIN && n <= SETTING_MAX;

/** Fill every knob. Unknown keys are ignored. A stored value outside 0..100_000 is ignored (the code default stands). */
export function resolveSettings(rows: readonly { key: string; value: number }[]): GameSettings {
  const out: GameSettings = {
    freeOnSignup: SETTING_DEFAULTS.free_on_signup,
    freeRidesDailyMax: SETTING_DEFAULTS.free_rides_daily_max,
    editorJobsPerDay: SETTING_DEFAULTS.editor_jobs_per_day,
    editorMaxSteps: SETTING_DEFAULTS.editor_max_steps,
    editorMaxOutputTokens: SETTING_DEFAULTS.editor_max_output_tokens,
    editorJobsParallel: SETTING_DEFAULTS.editor_jobs_parallel,
  };
  for (const row of rows) {
    if (!isSettingKey(row.key) || !inBounds(row.value)) continue;
    out[CAMEL[row.key]] = row.value;
  }
  return out;
}

/** Unknown key or a value outside 0..100_000. Called before a signature is issued or spent. */
export function assertSettingValue(key: string, value: number): asserts key is SettingKey {
  if (!isSettingKey(key) || !inBounds(value)) throw new BadRequestError('unknown setting or value out of range', 'bad_setting');
}
