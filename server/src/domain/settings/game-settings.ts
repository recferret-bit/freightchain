import { BadRequestError } from '../shared/errors.js';

/** Owner-tweakable integers in `player.GameSetting`. A missing or out-of-range row falls back to the code default. */
export const SETTING_KEYS = ['free_on_signup', 'free_rides_daily_max', 'offline_free_rides', 'offline_free_rides_per_ip'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_DEFAULTS: Record<SettingKey, number> = {
  free_on_signup: 10,
  free_rides_daily_max: 5,
  offline_free_rides: 3,
  offline_free_rides_per_ip: 10,
};

export const SETTING_MIN = 0;
export const SETTING_MAX = 100_000;
/** An admin adjust may not push a wallet past this. The daily cap is separate and never confiscates a surplus. */
export const FREE_RIDES_HARD_MAX = 100_000;

/** The resolved knobs the rest of the server reads. Camel case on the wire (`GET /api/admin/settings`). */
export interface GameSettings {
  freeOnSignup: number;
  freeRidesDailyMax: number;
  offlineFreeRides: number;
  offlineFreeRidesPerIp: number;
}

const CAMEL: Record<SettingKey, keyof GameSettings> = {
  free_on_signup: 'freeOnSignup',
  free_rides_daily_max: 'freeRidesDailyMax',
  offline_free_rides: 'offlineFreeRides',
  offline_free_rides_per_ip: 'offlineFreeRidesPerIp',
};

export const isSettingKey = (key: string): key is SettingKey => (SETTING_KEYS as readonly string[]).includes(key);

const inBounds = (n: number): boolean => Number.isInteger(n) && n >= SETTING_MIN && n <= SETTING_MAX;

/** Fill every knob. Unknown keys are ignored. A stored value outside 0..100_000 is ignored (the code default stands). */
export function resolveSettings(rows: readonly { key: string; value: number }[]): GameSettings {
  const out: GameSettings = {
    freeOnSignup: SETTING_DEFAULTS.free_on_signup,
    freeRidesDailyMax: SETTING_DEFAULTS.free_rides_daily_max,
    offlineFreeRides: SETTING_DEFAULTS.offline_free_rides,
    offlineFreeRidesPerIp: SETTING_DEFAULTS.offline_free_rides_per_ip,
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
