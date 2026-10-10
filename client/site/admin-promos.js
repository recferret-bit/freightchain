import { COSMETICS } from '../js/cosmetics.js';
import { SLOT_NAME, itemName } from './lobby-promo.js';

/* The admin page's PROMOCODES tab: the codes (active now by default), a form for a new one, and the log of who used what.
   Creating and disabling are signed by the admin's wallet for exactly that change (ctx.signAt → the server's text → the wallet) and audited.
   Server text (codes, descriptions, notes, wallets) goes in with textContent only – ctx.el never touches innerHTML. */

const STATES = [['active', 'ACTIVE'], ['scheduled', 'SCHEDULED'], ['ended', 'ENDED'], ['exhausted', 'USED UP'], ['disabled', 'DISABLED'], ['', 'ALL']];
const PAID = ['1h', '4h', '8h'];
const num = v => (v === '' || v == null ? null : Number(v));
/** a datetime-local value (the admin's own time zone) → epoch ms; blank → null */
export const localToMs = v => { if (!v) return null; const t = new Date(v).getTime(); return Number.isNaN(t) ? NaN : t; };

/** The form's fields → the body of POST /api/admin/promos (`promo`). Throws a sentence for what the server would refuse anyway, so the wallet is never asked to sign nonsense. */
export function promoFromForm(f) {
  const code = f.code.trim();
  if (!code) throw new Error('Give the code a name (3–32 letters, digits, - or _).');
  let effect;
  if (f.kind === 'free_rides') {
    const count = num(f.rides);
    if (!Number.isInteger(count) || count < 1) throw new Error('Free rides: a whole number from 1 up.');
    effect = { kind: 'free_rides', count };
  } else if (f.kind === 'cosmetic') {
    if (!COSMETICS[f.slot]?.includes(f.item) || f.item === COSMETICS[f.slot][0]) throw new Error('Pick an item to unlock (the first of each slot is the default everybody has).');
    effect = { kind: 'cosmetic', slot: f.slot, item: f.item };
  } else {
    const credits = num(f.credits), poolId = num(f.poolId);
    if (!PAID.includes(f.tier)) throw new Error('Pick a ride length for the tickets.');
    if (!Number.isInteger(credits) || credits < 1) throw new Error('Tickets: a whole number from 1 up.');
    effect = { kind: 'tickets', tier: f.tier, poolId: poolId == null ? null : poolId, credits };
  }
  const startsAt = localToMs(f.start), expiresAt = localToMs(f.end);
  if (Number.isNaN(startsAt) || Number.isNaN(expiresAt)) throw new Error('A start / end time is not a valid date.');
  if (expiresAt != null && expiresAt <= (startsAt ?? Date.now())) throw new Error('The end must be after the start (and in the future).');
  const max = num(f.max), perWallet = num(f.perWallet) ?? 1;
  if (max != null && (!Number.isInteger(max) || max < 1)) throw new Error('Max redemptions: a whole number from 1 up, or empty for unlimited.');
  if (!Number.isInteger(perWallet) || perWallet < 1) throw new Error('Per wallet: a whole number from 1 up.');
  return { code, effect, description: f.description.trim() || null, maxRedemptions: max, perWallet, startsAt, expiresAt, note: f.note.trim() || null };
}

export async function promosTab(ctx, filter = {}) {
  const { api, el, view, signAt, time, ago, wallet } = ctx;
  const state = filter.state ?? 'active';
  const [{ promos }, { rows }] = await Promise.all([
    api(`promos${state ? `?state=${state}` : ''}`),
    api(`promos/redemptions?limit=200${filter.code ? `&code=${encodeURIComponent(filter.code)}` : ''}${filter.wallet ? `&wallet=${encodeURIComponent(filter.wallet)}` : ''}`),
  ]);
  const reload = (over = {}) => promosTab(ctx, { ...filter, ...over });
  const note = el('p', { class: 'msg dim', id: 'promo-note', role: 'status' });
  const say = (text, bad = false) => { note.textContent = text; note.className = `msg ${bad ? 'bad' : 'dim'}`; };

  const disabling = new Set();   // one click = one wallet prompt
  const disable = async code => {
    if (disabling.has(code)) return;
    disabling.add(code);
    try {
      say(`Sign in your wallet to disable ${code}…`);
      const signature = await signAt('promos/challenge', { action: 'promo_disable', code });
      await api(`promos/${encodeURIComponent(code)}/disable`, { signature });
      await reload();
    } catch (e) { say(e.message, true); } finally { disabling.delete(code); }
  };
  const when = p => `${time(p.startsAt)} → ${p.expiresAt ? time(p.expiresAt) : 'no end'}`;
  const seg = el('div', { class: 'seg', id: 'promo-states' }, STATES.map(([id, label]) => el('button', { class: id === state ? 'on' : '', 'data-state': id, onclick: () => reload({ state: id }) }, label)));
  const list = promos.length ? el('div', { class: 'card', style: 'padding:6px 8px;overflow-x:auto' }, el('table', { class: 'dense', id: 'promo-table' },
    el('thead', {}, el('tr', {}, ...['code', 'gives', 'players see', 'used', 'per wallet', 'valid', 'state', ''].map(h => el('th', {}, h)))),
    el('tbody', {}, promos.map(p => el('tr', { 'data-code': p.code },
      el('td', {}, el('a', { href: '#promos', class: 'mono', title: 'who used it', onclick: e => { e.preventDefault(); reload({ code: p.code }); } }, p.code)),
      el('td', {}, p.label), el('td', { class: 'dim' }, p.description ?? '–'), el('td', {}, `${p.redeemed}${p.maxRedemptions == null ? '' : ` / ${p.maxRedemptions}`}`), el('td', {}, p.perWallet),
      el('td', { class: 'dim' }, when(p)), el('td', {}, el('span', { class: `v ${p.state === 'active' ? 'verified' : p.state === 'scheduled' ? 'flagged' : p.state === 'disabled' ? 'rejected' : 'none'}` }, p.state.toUpperCase())),
      el('td', {}, ['active', 'scheduled'].includes(p.state) ? el('button', { class: 'reject', onclick: () => disable(p.code) }, 'DISABLE') : '')))))) : el('div', { class: 'card empty' }, `No ${state || ''} promo codes.`.replace('  ', ' '));

  const used = rows.length ? el('div', { class: 'card', style: 'padding:6px 8px;overflow-x:auto' }, el('table', { class: 'dense', id: 'promo-used' },
    el('thead', {}, el('tr', {}, ...['when', 'code', 'wallet', 'gave', 'n'].map(h => el('th', {}, h)))),
    el('tbody', {}, rows.map(r => el('tr', {}, el('td', { title: time(r.at) }, ago(r.at)), el('td', { class: 'mono' }, r.code),
      el('td', {}, el('a', { href: '#promos', title: r.wallet, class: 'mono', onclick: e => { e.preventDefault(); reload({ wallet: r.wallet }); } }, wallet(r.wallet))), el('td', {}, r.label), el('td', {}, r.n)))))) : el('div', { class: 'card empty' }, 'Nobody has redeemed a code' + (filter.code || filter.wallet ? ' matching this filter.' : ' yet.'));
  const filtered = filter.code || filter.wallet;

  view.replaceChildren(
    el('h2', {}, 'PROMO CODES'), seg, list, note,
    el('h2', {}, 'NEW PROMO CODE'), form(ctx, { say, reload }),
    el('h2', {}, filtered ? `USED BY PLAYERS · ${filter.code ?? ''}${filter.code && filter.wallet ? ' · ' : ''}${filter.wallet ? 'one wallet' : ''}` : 'USED BY PLAYERS'),
    filtered ? el('p', { class: 'dim' }, el('a', { href: '#promos', onclick: e => { e.preventDefault(); reload({ code: null, wallet: null }); } }, '← all redemptions')) : '', used);
}

function form(ctx, { say, reload }) {
  const { api, el, signAt } = ctx;
  const field = (label, input, hint) => el('label', { class: 'fld' }, el('span', {}, label), input, hint ? el('small', { class: 'dim' }, hint) : '');
  const inp = (id, attrs = {}) => el('input', { id, ...attrs });
  const sel = (id, opts, attrs = {}) => el('select', { id, ...attrs }, opts.map(([v, l]) => el('option', { value: v }, l)));
  const code = inp('pf-code', { maxlength: 32, placeholder: 'e.g. WELCOME', autocapitalize: 'characters', spellcheck: 'false', autocomplete: 'off' });
  const kind = sel('pf-kind', [['free_rides', 'Free rides'], ['tickets', 'Free paid-ride tickets'], ['cosmetic', 'Cockpit part (wheel / paint / shifter / dice / needles)']]);
  const rides = inp('pf-rides', { type: 'number', min: 1, max: 20, value: 1 });
  const presets = el('div', { class: 'presets' }, el('span', {}, 'Quick set'), el('div', {}, [1, 3].map(n => el('button', { type: 'button', class: 'ghost', onclick: () => { rides.value = n; } }, `${n} free ride${n === 1 ? '' : 's'}`))));
  const tier = sel('pf-tier', PAID.map(t => [t, { '1h': '1 hour', '4h': '4 hours', '8h': '8 hours' }[t]])), credits = inp('pf-credits', { type: 'number', min: 1, max: 100, value: 1 }), poolId = inp('pf-pool', { type: 'number', min: 0, placeholder: 'live pool of the tier' });
  const slot = sel('pf-slot', Object.keys(COSMETICS).map(s => [s, SLOT_NAME[s] ?? s])), item = sel('pf-item', []);
  const fillItems = () => item.replaceChildren(...COSMETICS[slot.value].slice(1).map(i => el('option', { value: i }, itemName(i))));
  slot.onchange = fillItems; fillItems();
  const groups = { free_rides: el('div', { class: 'grp g3' }, field('Rides per redemption', rides, '1–20; may go above the daily 5'), presets), tickets: el('div', { class: 'grp g3' }, field('Ride length', tier), field('Tickets per redemption', credits), field('Pin to pool #', poolId, 'empty = the live pool of that length')), cosmetic: el('div', { class: 'grp g3' }, field('Slot', slot), field('Item', item)) };
  const showKind = () => { for (const [k, g] of Object.entries(groups)) g.hidden = k !== kind.value; };
  kind.onchange = showKind; showKind();
  const description = inp('pf-desc', { maxlength: 200, placeholder: 'shown to players, e.g. "Welcome gift"' }), start = inp('pf-start', { type: 'datetime-local' }), end = inp('pf-end', { type: 'datetime-local' });
  const max = inp('pf-max', { type: 'number', min: 1, placeholder: 'unlimited' }), perWallet = inp('pf-per', { type: 'number', min: 1, value: 1 }), note = inp('pf-note', { maxlength: 500, placeholder: 'private, for the team' });
  const go = el('button', { type: 'submit', id: 'pf-go' }, 'SIGN & CREATE');
  const submit = async e => {
    e.preventDefault();
    let promo;
    try {
      promo = promoFromForm({ code: code.value, kind: kind.value, rides: rides.value, tier: tier.value, credits: credits.value, poolId: poolId.value, slot: slot.value, item: item.value, description: description.value, start: start.value, end: end.value, max: max.value, perWallet: perWallet.value, note: note.value });
    } catch (err) { say(err.message, true); return; }
    go.disabled = true;
    try {
      say('Sign in your wallet – the text names every field of the code…');
      const signature = await signAt('promos/challenge', { action: 'promo_create', promo });
      const created = await api('promos', { promo, signature });
      await reload({ state: 'active', code: null, wallet: null });
      const n = document.getElementById('promo-note'); if (n) { n.textContent = `Created ${created.code} – ${created.label}.`; n.className = 'msg good'; }
    } catch (err) { say(err.message, true); go.disabled = false; }
  };
  const sec = (title, sub, ...kids) => el('section', { class: 'fsec' }, el('h3', {}, title, el('small', {}, sub)), ...kids);
  return el('form', { class: 'card pform', id: 'promo-form', onsubmit: submit },
    sec('1 · What it gives', 'the code and its effect', el('div', { class: 'g2' }, field('Code', code, '3–32 letters, digits, - or _; case does not matter'), field('Effect', kind)), ...Object.values(groups)),
    sec('2 · When it works', 'times are in your time zone', el('div', { class: 'g2' }, field('Starts', start, 'empty = now'), field('Ends', end, 'empty = never'))),
    sec('3 · Limits', 'how often it can be used', el('div', { class: 'g2' }, field('Max redemptions (all players)', max, 'empty = unlimited'), field('Per wallet', perWallet, 'times one player can use it'))),
    sec('4 · Text', 'what players and the team read', el('div', { class: 'g2' }, field('Players see', description, 'shown in the lobby next to the code'), field('Note', note, 'private, only on this page'))),
    el('div', { class: 'actions pgo' }, go, el('span', { class: 'dim' }, 'A code cannot be edited once created – only disabled. Everything it already gave stays.')));
}
