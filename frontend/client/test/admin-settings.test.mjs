import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTING_KNOBS } from '../site/admin-settings.js';

/* key, camelCase field on GET /api/admin/settings, min, max. Existing free-ride knobs stay 0..100_000. */
const RANGES = [
  ['weekly_ticket_1h_enabled', 'weeklyTicket1hEnabled', 0, 1],
  ['weekly_ticket_1h_days', 'weeklyTicket1hDays', 1, 100_000],
  ['weekly_ticket_4h_enabled', 'weeklyTicket4hEnabled', 0, 1],
  ['weekly_ticket_4h_days', 'weeklyTicket4hDays', 1, 100_000],
  ['weekly_ticket_8h_enabled', 'weeklyTicket8hEnabled', 0, 1],
  ['weekly_ticket_8h_days', 'weeklyTicket8hDays', 1, 100_000],
  ['free_on_signup', 'freeOnSignup', 0, 100_000],
  ['free_rides_daily_max', 'freeRidesDailyMax', 0, 100_000],
  ['referral_max', 'referralMax', 1, 1000],
  ['referral_invite_start', 'referralInviteStart', 0, 1000],
  ['referral_invite_step', 'referralInviteStep', 0, 1000],
  ['referral_shifts_per_step', 'referralShiftsPerStep', 1, 1000],
  ['referral_invite_ttl_days', 'referralInviteTtlDays', 1, 90],
  ['referral_free_ride_window_days', 'referralFreeRideWindowDays', 1, 90],
  ['referral_free_rides_referrer', 'referralFreeRidesReferrer', 0, 20],
  ['referral_free_rides_referee', 'referralFreeRidesReferee', 0, 20],
  ['referral_free_ride_weekly_cap', 'referralFreeRideWeeklyCap', 0, 1000],
  ['referral_referrer_part_bps', 'referralReferrerPartBps', 5001, 10_000],
  ['referral_ride_cap_lamports', 'referralRideCapLamports', 0, 2_000_000_000],
  ['referral_donation_share_bps', 'referralDonationShareBps', 0, 10_000],
  ['referral_donation_cap_lamports', 'referralDonationCapLamports', 0, 2_000_000_000],
  ['editor_jobs_per_day', 'editorJobsPerDay', 0, 100_000],
  ['editor_max_steps', 'editorMaxSteps', 0, 100_000],
  ['editor_max_output_tokens', 'editorMaxOutputTokens', 0, 100_000],
  ['editor_max_input_ktokens', 'editorMaxInputKTokens', 0, 100_000],
  ['editor_jobs_parallel', 'editorJobsParallel', 0, 100_000],
];

test('each settings knob has its own min and max', () => {
  assert.deepEqual(SETTING_KNOBS.map(([key, prop, , , min, max]) => [key, prop, min, max]), RANGES);
  for (const [, , label] of SETTING_KNOBS) assert.match(label, /^[A-Z0-9]/);
});
