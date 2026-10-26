/* The admin page's SETTINGS tab: the game knobs (`player.GameSetting`) and one wallet's free rides.
   Every change is signed by the admin's wallet for exactly that change (ctx.signAt → the server's text → the wallet) and audited.
   Server text goes in with textContent only – ctx.el never touches innerHTML. */

/* key, camelCase field on GET /api/admin/settings, label, hint, min, max. Free-ride knobs stay 0..100_000. Each knob has its own range. */
export const SETTING_KNOBS = [
  ['weekly_ticket_1h_enabled', 'weeklyTicket1hEnabled', '1h granted ticket', '0 off, 1 on. Default on. Not a purchase. Does not mint TEN4', 0, 1],
  ['weekly_ticket_1h_days', 'weeklyTicket1hDays', '1h grant interval (days)', 'how often one 1h ticket is granted. At least 1. Default 7', 1, 100_000],
  ['weekly_ticket_4h_enabled', 'weeklyTicket4hEnabled', '4h granted ticket', '0 off, 1 on. Default off', 0, 1],
  ['weekly_ticket_4h_days', 'weeklyTicket4hDays', '4h grant interval (days)', 'how often one 4h ticket is granted. At least 1. Default 7, and the flag is off', 1, 100_000],
  ['weekly_ticket_8h_enabled', 'weeklyTicket8hEnabled', '8h granted ticket', '0 off, 1 on. Default off', 0, 1],
  ['weekly_ticket_8h_days', 'weeklyTicket8hDays', '8h grant interval (days)', 'how often one 8h ticket is granted. At least 1. Default 7, and the flag is off', 1, 100_000],
  ['free_on_signup', 'freeOnSignup', 'Free rides on sign-up (retired)', 'stored only. Training rides are unlimited and do not spend this', 0, 100_000],
  ['free_rides_daily_max', 'freeRidesDailyMax', 'Daily refill cap (retired)', 'the midnight refill no longer runs. The column stays', 0, 100_000],
  ['referral_max', 'referralMax', 'RETIRED: Invite cap', 'the most invites one wallet can hold', 1, 1000],
  ['referral_invite_start', 'referralInviteStart', 'RETIRED: Invites at the start', 'how many invites a wallet has before any verified paid shift', 0, 1000],
  ['referral_invite_step', 'referralInviteStep', 'RETIRED: Invites each step', 'extra invites earned each time the step is reached', 0, 1000],
  ['referral_shifts_per_step', 'referralShiftsPerStep', 'RETIRED: Paid shifts per step', 'verified paid shifts between those invite steps', 1, 1000],
  ['referral_invite_ttl_days', 'referralInviteTtlDays', 'RETIRED: Invite window, days', 'a pending invite expires after this many days with no verified finish', 1, 90],
  ['referral_free_ride_window_days', 'referralFreeRideWindowDays', 'RETIRED: Free-ride bonus window, days', 'the friend must finish the qualifying free ride within this many days of the invite', 1, 90],
  ['referral_free_rides_referrer', 'referralFreeRidesReferrer', 'RETIRED: Free rides for the inviter', 'granted when a friend qualifies inside that window', 0, 20],
  ['referral_free_rides_referee', 'referralFreeRidesReferee', 'RETIRED: Free rides for the friend', 'granted to the invited wallet on that same qualify', 0, 20],
  ['referral_free_ride_weekly_cap', 'referralFreeRideWeeklyCap', 'RETIRED: Free-ride bonuses a window', 'how many of those bonuses one inviter can receive inside the free-ride bonus window', 0, 1000],
  ['referral_referrer_part_bps', 'referralReferrerPartBps', "Inviter's part of a slice", 'basis points of a sponsored rider\'s referral slice that go to the inviter (10 000 is all of it)', 5001, 10_000],
  ['referral_ride_cap_lamports', 'referralRideCapLamports', 'Inviter cap per pool', 'lamports; the most one inviter takes from one pool (1 SOL is 1 000 000 000)', 0, 2_000_000_000],
  ['referral_donation_share_bps', 'referralDonationShareBps', 'RETIRED: Donation share to the inviter', 'basis points of a spectator donation that go to the driver\'s inviter (10 000 is all of it)', 0, 10_000],
  ['referral_donation_cap_lamports', 'referralDonationCapLamports', 'RETIRED: Donation cap per friend', 'lamports; the lifetime cap of that share between one inviter and one friend', 0, 2_000_000_000],
  ['trust_finish_points', 'trustFinishPoints', 'Trust: verified finish day', 'points once per UTC completion day', 0, 100],
  ['trust_finish_days_per_week', 'trustFinishDaysPerWeek', 'Trust: finish days per week', 'maximum credited days in an ISO week', 0, 7],
  ['trust_finish_cap', 'trustFinishCap', 'Trust: finish score ceiling', 'finishes cannot raise the score above this; higher existing scores stay', 0, 100],
  ['trust_social_cap', 'trustSocialCap', 'Trust: social points cap', 'combined lifetime points from first verified social bindings', 0, 100],
  ['referral_pending_ttl_hours', 'referralPendingTtlHours', 'Convoy: pending hours', 'New invites only; saved deadlines never move', 1, 2160],
  ['referral_qualify_window_days', 'referralQualifyWindowDays', 'Convoy: qualification days', 'New activations only; saved deadlines never move', 1, 365],
  ['referral_pending_base', 'referralPendingBase', 'Convoy: base pending slots', 'Capacity is min(max, base + per active × active friends)', 0, 1000],
  ['referral_pending_per_active', 'referralPendingPerActive', 'Convoy: slots per active friend', 'Friends with a counted ride in the activity window', 0, 100],
  ['referral_pending_max', 'referralPendingMax', 'Convoy: maximum pending slots', 'Existing invitations are retained if the limit is lowered', 1, 1000],
  ['referral_active_window_days', 'referralActiveWindowDays', 'Convoy: activity window days', 'Rolling lookback for pending capacity', 1, 365],
  ['referral_ten4_m1_amount', 'referralTen4M1Amount', 'Convoy: M1 TEN4 base', 'Snapshot on activation; actual amount is reduced by chain eras and caps', 1, 1000],
  ['referral_ten4_m1_weeks', 'referralTen4M1Weeks', 'Convoy: M1 distinct weeks', 'Snapshot on activation; each week needs a counted ride', 1, 52],
  ['referral_ten4_m2_amount', 'referralTen4M2Amount', 'Convoy: M2 TEN4 base', 'Snapshot on activation; actual amount is reduced by chain eras and caps', 1, 1000],
  ['referral_ten4_m2_weeks', 'referralTen4M2Weeks', 'Convoy: M2 distinct weeks', 'Snapshot on activation; M1 is still required', 1, 52],
  ['referral_min_trust_referrer', 'referralMinTrustReferrer', 'Convoy: referrer trust minimum', 'Snapshot on activation and earned reward; payout safety floor is 50', 50, 100],
  ['referral_referee_promo_per_referrer_day', 'referralRefereePromoPerReferrerDay', 'Convoy: promo gifts per day', 'Per referrer, UTC; zero pauses new gifts', 0, 1000],
  ['referral_referee_promo_per_referrer_week', 'referralRefereePromoPerReferrerWeek', 'Convoy: promo gifts per week', 'Per referrer, ISO week; zero pauses new gifts', 0, 10000],
  ['referral_referee_promo_global_week', 'referralRefereePromoGlobalWeek', 'Convoy: global promo gifts per week', 'Shared ISO-week budget; zero pauses new gifts', 0, 100000],
  ['referral_referee_promo_ranked', 'referralRefereePromoRanked', 'Convoy: allow ranked promo', 'Snapshot on activation; still no TEN4 or counted Convoy week', 0, 1],
  ['referral_count_weekly_grant', 'referralCountWeeklyGrant', 'Weekly grants count for Convoy', '0 off; 1 counts verified ranked grants when friend trust is 100', 0, 1],
  ['editor_jobs_per_day', 'editorJobsPerDay', 'AI editor: jobs per day', 'model-editor requests per editor wallet per UTC day (storybook)', 0, 100_000],
  ['editor_max_steps', 'editorMaxSteps', 'AI editor: steps per job', 'model turns one request may take (each may call the MCP tools)', 0, 100_000],
  ['editor_max_output_tokens', 'editorMaxOutputTokens', 'AI editor: output tokens', 'total output tokens across all model turns in one job', 0, 100_000],
  ['editor_max_input_ktokens', 'editorMaxInputKTokens', 'AI editor: input tokens per job (thousands)', 'the cost cap: every model turn re-sends the history; a job past it fails', 0, 100_000],
  ['editor_jobs_parallel', 'editorJobsParallel', 'AI editor: parallel jobs', 'jobs running at once across all app replicas; extra jobs queue; 0 pauses new starts', 0, 100_000],
];
const MAX = 100_000;

/** The wallet + amount fields → the body of POST /api/admin/players/free-rides (minus the signature). Throws a sentence for what the server would refuse, so the wallet is never asked to sign nonsense. */
export function adjustFromForm(f) {
  const wallet = f.wallet.trim(), delta = Number(f.delta);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new Error('Paste the full wallet address (32–44 base58 characters).');
  if (f.delta === '' || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX) throw new Error(`Free rides: a whole number other than 0, up to ±${MAX}.`);
  return { wallet, delta };
}

export async function settingsTab(ctx, wallet0 = '') {
  const { api, el, view, signAt } = ctx;
  const s = await api('settings');
  const say = el('p', { class: 'msg dim', id: 'set-note', role: 'status' });
  const tell = (text, cls = 'dim') => { say.textContent = text; say.className = `msg ${cls}`; };
  const reload = async text => { await settingsTab(ctx, wallet0); const n = document.getElementById('set-note'); if (n && text) { n.textContent = text; n.className = 'msg good'; } };

  const rows = SETTING_KNOBS.map(([key, prop, label, hint, min, max]) => {
    const input = el('input', { type: 'number', min, max, step: 1, value: s[prop] ?? '', 'aria-label': label, 'data-key': key });
    const save = el('button', { type: 'button', 'data-key': key, onclick: async () => {
      const value = Number(input.value);
      if (input.value === '' || !Number.isInteger(value) || value < min || value > max) { tell(`${label}: a whole number from ${min} to ${max}.`, 'bad'); return; }
      if (value === s[prop]) { tell(`${label} is already ${value}.`); return; }
      save.disabled = true;   // one click = one signature
      try {
        tell(`Sign in your wallet to set ${key} = ${value}…`);
        const signature = await signAt('settings/challenge', { action: 'setting_update', key, value });
        await api('settings', { key, value, signature });
      } catch (e) { tell(e.message, 'bad'); save.disabled = false; return; }
      try { await reload(`${key} is now ${value}.`); } catch { tell(`${key} is saved (${value}); reloading the list failed – press REFRESH.`, 'bad'); }
    } }, 'SIGN & SAVE');
    return el('tr', {}, el('td', {}, label, el('br'), el('small', { class: 'dim mono' }, key)), el('td', {}, input), el('td', {}, save), el('td', { class: 'dim' }, hint, el('br'), el('small', {}, `${min}–${max}`)));
  });

  const w = el('input', { id: 'fr-wallet', placeholder: 'wallet (full address)', value: wallet0, 'aria-label': 'wallet', spellcheck: 'false', autocomplete: 'off' });
  const d = el('input', { id: 'fr-delta', type: 'number', step: 1, placeholder: '+5 or -2', 'aria-label': 'free rides to add (negative removes)' });
  const go = el('button', { type: 'submit', id: 'fr-go' }, 'SIGN & APPLY');
  const adjust = async e => {
    e.preventDefault();
    let body;
    try { body = adjustFromForm({ wallet: w.value, delta: d.value }); } catch (err) { tell(err.message, 'bad'); return; }
    go.disabled = true;
    try {
      tell('Sign in your wallet – the text names the wallet and the amount…');
      const signature = await signAt('players/free-rides/challenge', { action: 'free_rides_adjust', ...body });
      const r = await api('players/free-rides', { ...body, signature });
      w.value = ''; d.value = '';
      tell(`Done – ${body.delta > 0 ? '+' : ''}${body.delta} for ${body.wallet.slice(0, 4)}…${body.wallet.slice(-4)}${r && r.freeRides != null ? `; balance now ${r.freeRides}` : ''}.`, 'good');
    } catch (err) { tell(err.message, 'bad'); }
    go.disabled = false;
  };

  view.replaceChildren(
    el('h2', {}, 'GAME SETTINGS'),
    el('p', { class: 'dim' }, 'Runtime knobs, each a whole number in its own range. They apply at once; every change is signed and lands in the AUDIT tab.'),
    el('div', { class: 'card', style: 'padding:6px 8px;overflow-x:auto' }, el('table', { class: 'dense', id: 'set-table' }, el('thead', {}, el('tr', {}, ...['setting', 'value', '', 'what it does'].map(h => el('th', {}, h)))), el('tbody', {}, rows))),
    el('p', { class: 'dim' }, 'Convoy program limits are immutable here: 4M TEN4 vault, 1,000 per wallet per 30-day program month, and 30,000 globally for the first 3 months then 60,000. Admin values cannot override these chain caps. Milestone promises are saved at activation; pending and qualification deadlines never move.'),
    el('h2', {}, 'FREE RIDES OF ONE WALLET'),
    el('form', { class: 'card filters', id: 'fr-form', onsubmit: adjust }, w, d, go,
      el('small', { class: 'dim' }, 'A positive number adds, a negative one removes; the balance cannot go below 0 or above 100 000. An existing wallet only.')),
    say);
}
