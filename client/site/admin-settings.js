/* The admin page's SETTINGS tab: the game knobs (`player.GameSetting`) and one wallet's free rides.
   Every change is signed by the admin's wallet for exactly that change (ctx.signAt → the server's text → the wallet) and audited.
   Server text goes in with textContent only – ctx.el never touches innerHTML. */

/* key, camelCase field on GET /api/admin/settings, label, hint, min, max. Free-ride knobs stay 0..100_000. Each referral knob has its own range. */
export const SETTING_KNOBS = [
  ['free_on_signup', 'freeOnSignup', 'Free rides on sign-up', 'what a new wallet starts with; existing wallets are not topped up', 0, 100_000],
  ['free_rides_daily_max', 'freeRidesDailyMax', 'Daily refill cap', 'the +1 at 00:00 UTC stops here and never takes a surplus away', 0, 100_000],
  ['referral_max', 'referralMax', 'Invite cap', 'the most invites one wallet can hold', 1, 1000],
  ['referral_invite_start', 'referralInviteStart', 'Invites at the start', 'how many invites a wallet has before any verified paid shift', 0, 1000],
  ['referral_invite_step', 'referralInviteStep', 'Invites each step', 'extra invites earned each time the step is reached', 0, 1000],
  ['referral_shifts_per_step', 'referralShiftsPerStep', 'Paid shifts per step', 'verified paid shifts between those invite steps', 1, 1000],
  ['referral_invite_ttl_days', 'referralInviteTtlDays', 'Invite window, days', 'a pending invite expires after this many days with no verified finish', 1, 90],
  ['referral_free_ride_window_days', 'referralFreeRideWindowDays', 'Free-ride bonus window, days', 'the friend must finish the qualifying free ride within this many days of the invite', 1, 90],
  ['referral_free_rides_referrer', 'referralFreeRidesReferrer', 'Free rides for the inviter', 'granted when a friend qualifies inside that window', 0, 20],
  ['referral_free_rides_referee', 'referralFreeRidesReferee', 'Free rides for the friend', 'granted to the invited wallet on that same qualify', 0, 20],
  ['referral_free_ride_weekly_cap', 'referralFreeRideWeeklyCap', 'Free-ride bonuses a window', 'how many of those bonuses one inviter can receive inside the free-ride bonus window', 0, 1000],
  ['referral_referrer_part_bps', 'referralReferrerPartBps', "Inviter's part of a slice", 'basis points of a sponsored rider\'s referral slice that go to the inviter (10 000 is all of it)', 5001, 10_000],
  ['referral_ride_cap_lamports', 'referralRideCapLamports', 'Inviter cap per pool', 'lamports; the most one inviter takes from one pool (1 SOL is 1 000 000 000)', 0, 2_000_000_000],
  ['referral_donation_share_bps', 'referralDonationShareBps', 'Donation share to the inviter', 'basis points of a spectator donation that go to the driver\'s inviter (10 000 is all of it)', 0, 10_000],
  ['referral_donation_cap_lamports', 'referralDonationCapLamports', 'Donation cap per friend', 'lamports; the lifetime cap of that share between one inviter and one friend', 0, 2_000_000_000],
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
    el('h2', {}, 'FREE RIDES OF ONE WALLET'),
    el('form', { class: 'card filters', id: 'fr-form', onsubmit: adjust }, w, d, go,
      el('small', { class: 'dim' }, 'A positive number adds, a negative one removes; the balance cannot go below 0 or above 100 000. An existing wallet only.')),
    say);
}
