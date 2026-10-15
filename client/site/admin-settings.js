/* The admin page's SETTINGS tab: the game knobs (`player.GameSetting`) and one wallet's free rides.
   Every change is signed by the admin's wallet for exactly that change (ctx.signAt → the server's text → the wallet) and audited.
   Server text goes in with textContent only – ctx.el never touches innerHTML. */

const KNOBS = [
  ['free_on_signup', 'freeOnSignup', 'Free rides on sign-up', 'what a NEW wallet starts with; existing wallets are not topped up'],
  ['free_rides_daily_max', 'freeRidesDailyMax', 'Daily refill cap', 'the +1 at 00:00 UTC stops here and never takes a surplus away'],
  ['editor_jobs_per_day', 'editorJobsPerDay', 'AI editor: jobs per day', 'model-editor requests per editor wallet per UTC day (storybook)'],
  ['editor_max_steps', 'editorMaxSteps', 'AI editor: steps per job', 'model turns one request may take (each may call the MCP tools)'],
  ['editor_max_output_tokens', 'editorMaxOutputTokens', 'AI editor: output tokens', 'per model turn'],
  ['editor_max_input_ktokens', 'editorMaxInputKTokens', 'AI editor: input tokens per job (thousands)', 'the cost cap: every model turn re-sends the history; a job past it fails'],
  ['editor_jobs_parallel', 'editorJobsParallel', 'AI editor: parallel jobs', 'jobs running at once on the server; 0 pauses the AI editor'],
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

  const rows = KNOBS.map(([key, prop, label, hint]) => {
    const input = el('input', { type: 'number', min: 0, max: MAX, value: s[prop], 'aria-label': label, 'data-key': key });
    const save = el('button', { type: 'button', 'data-key': key, onclick: async () => {
      const value = Number(input.value);
      if (input.value === '' || !Number.isInteger(value) || value < 0 || value > MAX) { tell(`${label}: a whole number from 0 to ${MAX}.`, 'bad'); return; }
      if (value === s[prop]) { tell(`${label} is already ${value}.`); return; }
      save.disabled = true;   // one click = one signature
      try {
        tell(`Sign in your wallet to set ${key} = ${value}…`);
        const signature = await signAt('settings/challenge', { action: 'setting_update', key, value });
        await api('settings', { key, value, signature });
      } catch (e) { tell(e.message, 'bad'); save.disabled = false; return; }
      try { await reload(`${key} is now ${value}.`); } catch { tell(`${key} is saved (${value}); reloading the list failed – press REFRESH.`, 'bad'); }
    } }, 'SIGN & SAVE');
    return el('tr', {}, el('td', {}, label, el('br'), el('small', { class: 'dim mono' }, key)), el('td', {}, input), el('td', {}, save), el('td', { class: 'dim' }, hint));
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
    el('p', { class: 'dim' }, 'Runtime knobs, whole numbers 0–100 000. They apply at once; every change is signed and lands in the AUDIT tab.'),
    el('div', { class: 'card', style: 'padding:6px 8px;overflow-x:auto' }, el('table', { class: 'dense', id: 'set-table' }, el('thead', {}, el('tr', {}, ...['setting', 'value', '', 'what it does'].map(h => el('th', {}, h)))), el('tbody', {}, rows))),
    el('h2', {}, 'FREE RIDES OF ONE WALLET'),
    el('form', { class: 'card filters', id: 'fr-form', onsubmit: adjust }, w, d, go,
      el('small', { class: 'dim' }, 'A positive number adds, a negative one removes; the balance cannot go below 0 or above 100 000. An existing wallet only.')),
    say);
}
