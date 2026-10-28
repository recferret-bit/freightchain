import type { PaidTierId } from '../rides/ride-tier.js';
import { BadRequestError } from '../shared/errors.js';

/** Owner-tweakable integers in `player.GameSetting`. A missing or out-of-range row falls back to the code default. */
export const SETTING_KEYS = [
  'trust_network_evidence_enabled', 'trust_funding_evidence_enabled',
  'event_mode_enabled',
  'event_week_start_utc',
  'event_last_start_utc',
  'event_week_end_utc',
  'event_review_end_utc',
  'event_appeals_end_utc',
  'airdrop_x_budget_cents',
  'airdrop_x_check_cost_cents',
  'free_on_signup', 'free_rides_daily_max',
  'weekly_ticket_1h_enabled', 'weekly_ticket_1h_days',
  'weekly_ticket_4h_enabled', 'weekly_ticket_4h_days',
  'weekly_ticket_8h_enabled', 'weekly_ticket_8h_days',
  'editor_jobs_per_day', 'editor_max_steps', 'editor_max_output_tokens', 'editor_max_input_ktokens', 'editor_jobs_parallel',
  'referral_max', 'referral_invite_start', 'referral_invite_step', 'referral_shifts_per_step', 'referral_invite_ttl_days',
  'referral_free_ride_window_days', 'referral_free_rides_referrer', 'referral_free_rides_referee', 'referral_free_ride_weekly_cap',
  'referral_referrer_part_bps', 'referral_ride_cap_lamports', 'referral_donation_share_bps', 'referral_donation_cap_lamports',
  'referral_pending_ttl_hours',
  'referral_qualify_window_days',
  'referral_pending_base',
  'referral_pending_per_active',
  'referral_pending_max',
  'referral_active_window_days',
  'referral_ten4_m1_amount',
  'referral_ten4_m1_weeks',
  'referral_ten4_m2_amount',
  'referral_ten4_m2_weeks',
  'referral_min_trust_referrer',
  'referral_referee_promo_per_referrer_day',
  'referral_referee_promo_per_referrer_week',
  'referral_referee_promo_global_week',
  'referral_referee_promo_ranked',
  'referral_count_weekly_grant',
  'trust_finish_points',
  'trust_finish_days_per_week',
  'trust_finish_cap',
  'trust_social_cap',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_DEFAULTS: Record<SettingKey, number> = {
  trust_network_evidence_enabled: 0, trust_funding_evidence_enabled: 0,
  event_mode_enabled: 0,
  event_week_start_utc: 0,
  event_last_start_utc: 0,
  event_week_end_utc: 0,
  event_review_end_utc: 0,
  event_appeals_end_utc: 0,
  airdrop_x_budget_cents: 10000,
  airdrop_x_check_cost_cents: 0,
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
  editor_max_output_tokens: 100_000,   // cumulative output tokens per job (GLM thinks on every turn)
  editor_max_input_ktokens: 500,   // input tokens per job, in thousands (every turn re-sends the history: the cost cap)
  editor_jobs_parallel: 5,   // jobs running at once across all app replicas (0 = the AI editor paused)
  referral_max: 30,
  referral_invite_start: 3,
  referral_invite_step: 3,
  referral_shifts_per_step: 5,
  referral_invite_ttl_days: 14,
  referral_free_ride_window_days: 7,
  referral_free_rides_referrer: 2,
  referral_free_rides_referee: 3,
  referral_free_ride_weekly_cap: 10,
  referral_referrer_part_bps: 8000,
  referral_ride_cap_lamports: 1_000_000_000,
  referral_donation_share_bps: 0,
  referral_donation_cap_lamports: 500_000_000,
  referral_pending_ttl_hours: 72,
  referral_qualify_window_days: 60,
  referral_pending_base: 5,
  referral_pending_per_active: 2,
  referral_pending_max: 100,
  referral_active_window_days: 30,
  referral_ten4_m1_amount: 100,
  referral_ten4_m1_weeks: 2,
  referral_ten4_m2_amount: 50,
  referral_ten4_m2_weeks: 5,
  referral_min_trust_referrer: 50,
  referral_referee_promo_per_referrer_day: 3,
  referral_referee_promo_per_referrer_week: 10,
  referral_referee_promo_global_week: 500,
  referral_referee_promo_ranked: 0,
  referral_count_weekly_grant: 1,
  trust_finish_points: 15,
  trust_finish_days_per_week: 2,
  trust_finish_cap: 100,
  trust_social_cap: 30,
};

/** Per key. `GameSetting.value` is a signed 32-bit int, so a lamport cap stops at 2e9. */
export const SETTING_BOUNDS: Record<SettingKey, { min: number; max: number }> = {
  trust_network_evidence_enabled: { min: 0, max: 1 }, trust_funding_evidence_enabled: { min: 0, max: 1 },
  event_mode_enabled: { min: 0, max: 1 },
  event_week_start_utc: { min: 0, max: 2147483647 },
  event_last_start_utc: { min: 0, max: 2147483647 },
  event_week_end_utc: { min: 0, max: 2147483647 },
  event_review_end_utc: { min: 0, max: 2147483647 },
  event_appeals_end_utc: { min: 0, max: 2147483647 },
  airdrop_x_budget_cents: { min: 0, max: 10000 },
  airdrop_x_check_cost_cents: { min: 0, max: 10000 },
  free_on_signup: { min: 0, max: 100_000 },
  free_rides_daily_max: { min: 0, max: 100_000 },
  weekly_ticket_1h_enabled: { min: 0, max: 1 },
  weekly_ticket_1h_days: { min: 1, max: 100_000 },
  weekly_ticket_4h_enabled: { min: 0, max: 1 },
  weekly_ticket_4h_days: { min: 1, max: 100_000 },
  weekly_ticket_8h_enabled: { min: 0, max: 1 },
  weekly_ticket_8h_days: { min: 1, max: 100_000 },
  editor_jobs_per_day: { min: 0, max: 100_000 },
  editor_max_steps: { min: 0, max: 100_000 },
  editor_max_output_tokens: { min: 0, max: 100_000 },
  editor_max_input_ktokens: { min: 0, max: 100_000 },
  editor_jobs_parallel: { min: 0, max: 100_000 },
  referral_max: { min: 1, max: 1000 },
  referral_invite_start: { min: 0, max: 1000 },
  referral_invite_step: { min: 0, max: 1000 },
  referral_shifts_per_step: { min: 1, max: 1000 },
  referral_invite_ttl_days: { min: 1, max: 90 },
  referral_free_ride_window_days: { min: 1, max: 90 },
  referral_free_rides_referrer: { min: 0, max: 20 },
  referral_free_rides_referee: { min: 0, max: 20 },
  referral_free_ride_weekly_cap: { min: 0, max: 1000 },
  referral_referrer_part_bps: { min: 5001, max: 10_000 },
  referral_ride_cap_lamports: { min: 0, max: 2_000_000_000 },
  referral_donation_share_bps: { min: 0, max: 10_000 },
  referral_donation_cap_lamports: { min: 0, max: 2_000_000_000 },
  referral_pending_ttl_hours: { min: 1, max: 2160 },
  referral_qualify_window_days: { min: 1, max: 365 },
  referral_pending_base: { min: 0, max: 1000 },
  referral_pending_per_active: { min: 0, max: 100 },
  referral_pending_max: { min: 1, max: 1000 },
  referral_active_window_days: { min: 1, max: 365 },
  referral_ten4_m1_amount: { min: 1, max: 1000 },
  referral_ten4_m1_weeks: { min: 1, max: 52 },
  referral_ten4_m2_amount: { min: 1, max: 1000 },
  referral_ten4_m2_weeks: { min: 1, max: 52 },
  referral_min_trust_referrer: { min: 50, max: 100 },
  referral_referee_promo_per_referrer_day: { min: 0, max: 1000 },
  referral_referee_promo_per_referrer_week: { min: 0, max: 10000 },
  referral_referee_promo_global_week: { min: 0, max: 100000 },
  referral_referee_promo_ranked: { min: 0, max: 1 },
  referral_count_weekly_grant: { min: 0, max: 1 },
  trust_finish_points: { min: 0, max: 100 },
  trust_finish_days_per_week: { min: 0, max: 7 },
  trust_finish_cap: { min: 0, max: 100 },
  trust_social_cap: { min: 0, max: 100 },
};

export const SETTING_MIN = 0;
export const SETTING_MAX = 100_000;
/** An admin adjust may not push a wallet past this. The daily cap is separate and never confiscates a surplus. */
export const FREE_RIDES_HARD_MAX = 100_000;

/** The resolved knobs the rest of the server reads. Camel case on the wire (`GET /api/admin/settings`). */
export interface GameSettings {
  trustNetworkEvidenceEnabled: number;
  trustFundingEvidenceEnabled: number;
  eventModeEnabled: number;
  eventWeekStartUtc: number;
  eventLastStartUtc: number;
  eventWeekEndUtc: number;
  eventReviewEndUtc: number;
  eventAppealsEndUtc: number;
  airdropXBudgetCents: number;
  airdropXCheckCostCents: number;
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
  referralMax: number;
  referralInviteStart: number;
  referralInviteStep: number;
  referralShiftsPerStep: number;
  referralInviteTtlDays: number;
  referralFreeRideWindowDays: number;
  referralFreeRidesReferrer: number;
  referralFreeRidesReferee: number;
  referralFreeRideWeeklyCap: number;
  referralReferrerPartBps: number;
  referralRideCapLamports: number;
  referralDonationShareBps: number;
  referralDonationCapLamports: number;
  referralPendingTtlHours: number;
  referralQualifyWindowDays: number;
  referralPendingBase: number;
  referralPendingPerActive: number;
  referralPendingMax: number;
  referralActiveWindowDays: number;
  referralTen4M1Amount: number;
  referralTen4M1Weeks: number;
  referralTen4M2Amount: number;
  referralTen4M2Weeks: number;
  referralMinTrustReferrer: number;
  referralRefereePromoPerReferrerDay: number;
  referralRefereePromoPerReferrerWeek: number;
  referralRefereePromoGlobalWeek: number;
  referralRefereePromoRanked: number;
  referralCountWeeklyGrant: number;
  trustFinishPoints: number;
  trustFinishDaysPerWeek: number;
  trustFinishCap: number;
  trustSocialCap: number;
}

const CAMEL: Record<SettingKey, keyof GameSettings> = {
  trust_network_evidence_enabled: 'trustNetworkEvidenceEnabled', trust_funding_evidence_enabled: 'trustFundingEvidenceEnabled',
  event_mode_enabled: 'eventModeEnabled',
  event_week_start_utc: 'eventWeekStartUtc',
  event_last_start_utc: 'eventLastStartUtc',
  event_week_end_utc: 'eventWeekEndUtc',
  event_review_end_utc: 'eventReviewEndUtc',
  event_appeals_end_utc: 'eventAppealsEndUtc',
  airdrop_x_budget_cents: 'airdropXBudgetCents',
  airdrop_x_check_cost_cents: 'airdropXCheckCostCents',
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
  referral_max: 'referralMax',
  referral_invite_start: 'referralInviteStart',
  referral_invite_step: 'referralInviteStep',
  referral_shifts_per_step: 'referralShiftsPerStep',
  referral_invite_ttl_days: 'referralInviteTtlDays',
  referral_free_ride_window_days: 'referralFreeRideWindowDays',
  referral_free_rides_referrer: 'referralFreeRidesReferrer',
  referral_free_rides_referee: 'referralFreeRidesReferee',
  referral_free_ride_weekly_cap: 'referralFreeRideWeeklyCap',
  referral_referrer_part_bps: 'referralReferrerPartBps',
  referral_ride_cap_lamports: 'referralRideCapLamports',
  referral_donation_share_bps: 'referralDonationShareBps',
  referral_donation_cap_lamports: 'referralDonationCapLamports',
  referral_pending_ttl_hours: 'referralPendingTtlHours',
  referral_qualify_window_days: 'referralQualifyWindowDays',
  referral_pending_base: 'referralPendingBase',
  referral_pending_per_active: 'referralPendingPerActive',
  referral_pending_max: 'referralPendingMax',
  referral_active_window_days: 'referralActiveWindowDays',
  referral_ten4_m1_amount: 'referralTen4M1Amount',
  referral_ten4_m1_weeks: 'referralTen4M1Weeks',
  referral_ten4_m2_amount: 'referralTen4M2Amount',
  referral_ten4_m2_weeks: 'referralTen4M2Weeks',
  referral_min_trust_referrer: 'referralMinTrustReferrer',
  referral_referee_promo_per_referrer_day: 'referralRefereePromoPerReferrerDay',
  referral_referee_promo_per_referrer_week: 'referralRefereePromoPerReferrerWeek',
  referral_referee_promo_global_week: 'referralRefereePromoGlobalWeek',
  referral_referee_promo_ranked: 'referralRefereePromoRanked',
  referral_count_weekly_grant: 'referralCountWeeklyGrant',
  trust_finish_points: 'trustFinishPoints',
  trust_finish_days_per_week: 'trustFinishDaysPerWeek',
  trust_finish_cap: 'trustFinishCap',
  trust_social_cap: 'trustSocialCap',
};

export const isSettingKey = (key: string): key is SettingKey => (SETTING_KEYS as readonly string[]).includes(key);

/** Check whether a value is within the key's configured bounds. */
export function settingAccepted(key: SettingKey, value: number): boolean {
  const b = SETTING_BOUNDS[key];
  return Number.isInteger(value) && value >= b.min && value <= b.max;
}

/** Whether this tier's grant is on, and how many UTC days sit between grants. */
export function tierGrant(settings: GameSettings, tier: PaidTierId): { enabled: boolean; days: number } {
  if (tier === '4h') return { enabled: settings.weeklyTicket4hEnabled === 1, days: settings.weeklyTicket4hDays };
  if (tier === '8h') return { enabled: settings.weeklyTicket8hEnabled === 1, days: settings.weeklyTicket8hDays };
  return { enabled: settings.weeklyTicket1hEnabled === 1, days: settings.weeklyTicket1hDays };
}

/** Fill every knob. Unknown keys are ignored. A stored value outside that key's bounds is ignored (the code default stands). */
export function resolveSettings(rows: readonly { key: string; value: number }[]): GameSettings {
  const out = {} as GameSettings;
  for (const key of SETTING_KEYS) out[CAMEL[key]] = SETTING_DEFAULTS[key];
  for (const row of rows) {
    if (!isSettingKey(row.key) || !settingAccepted(row.key, row.value)) continue;
    out[CAMEL[row.key]] = row.value;
  }
  return out;
}

/** Unknown key or a value outside that key's bounds. Called before a signature is issued or spent. */
export function assertSettingValue(key: string, value: number): asserts key is SettingKey {
  if (!isSettingKey(key) || !settingAccepted(key, value)) throw new BadRequestError('unknown setting or value out of range', 'bad_setting');
}
