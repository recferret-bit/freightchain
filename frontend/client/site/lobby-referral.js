import { el } from './dom.js';
import { LOOKS } from '../js/cosmetics.js';
import { itemName } from './lobby-promo.js';
import { GIFT_ITEMS, inviteLabel, shareUrl } from './referral.js';

const when = at => at && Number.isFinite(+new Date(at)) ? new Date(at).toLocaleString() : '–';
const progress = r => `${r.weeks} counted weeks · M1 ${r.m1 ? 'complete' : `${Math.min(r.weeks, 2)}/2`} · M2 ${r.m2 ? 'complete' : `${Math.min(r.weeks, 5)}/5`} · campaign tasks ${r.tasksComplete ? 'complete' : 'needed'}`;
const promo = r => r.promo === 'granted' ? '1h promo granted — use it under Promo Codes.' : r.promo === 'cap_reached' ? 'Promo gift cap reached; your Convoy activation still counts.' : 'Finish verified MEDIUM or HARD training within 72 hours to activate.';

/** Profile Convoy; all API-provided values become text nodes. */
export function referralSection({ api, short, base, origin, alive = () => true }) {
  const box = el('div', { id: 'ref-box' }, el('p', { class: 'dim' }, 'Loading…'));
  const note = el('p', { class: 'msg dim', id: 'ref-msg', role: 'status' });
  let row = null, board = null, busy = false;
  const say = (text, cls = 'dim') => { note.textContent = text; note.className = `msg ${cls}`; };
  const act = async task => {
    if (busy) return;
    busy = true;
    try { await task(); await load(); }
    catch (e) { if (alive()) say(e.message, 'bad'); }
    finally { busy = false; if (alive() && row) paint(); }
  };
  const invite = r => el('div', { class: 'card' },
    el('b', { title: r.wallet }, short(r.wallet)), ` · ${inviteLabel(r.status)}`,
    el('p', {}, progress(r)), el('p', { class: 'dim' }, `Deadline ${when(r.expiresAt)}. ${promo(r)}`));
  const paint = () => {
    const r = row, url = shareUrl(base, origin, r.code);
    const input = el('input', { id: 'ref-input', maxlength: 8, placeholder: 'INVITE CODE', 'aria-label': 'Convoy invite code', autocapitalize: 'characters', spellcheck: 'false' });
    box.replaceChildren(
      el('div', { class: 'ref-head' }, el('b', { class: 'ref-code', id: 'ref-code' }, r.code),
        el('button', { type: 'button', class: 'ghost', id: 'ref-copy', onclick: async () => {
          try { await navigator.clipboard.writeText(url); say('Link copied.', 'good'); }
          catch { say('Copy failed — select the link and copy it.', 'bad'); }
        } }, 'COPY LINK')),
      el('p', { class: 'dim ref-url' }, url),
      el('p', { class: 'ref-meta' }, `${r.pending} / ${r.capacity} pending · ${r.available} open · ${r.used} qualified`),
      el('p', { class: 'dim' }, 'Pending invites last 72 hours. Activation opens a 60-day window. Complete campaign tasks and verified ranked paid rides in 2 distinct ISO weeks for M1, then 5 for M2. Promo rides never count. Weekly tickets count only at trust 100 when enabled.'),
      el('p', { class: r.trustEligible ? 'dim' : 'warn' }, r.trustEligible ? 'Your trust meets the referrer requirement.' : 'Your trust must reach 50 before milestone rewards can be earned.'),
      el('p', { class: 'dim' }, 'M1: 100 TEN4 base · M2: 50 TEN4 base. Rewards have a 48-hour review hold and are reduced by emission eras and caps. There is no share of prizes or tips.'),
      r.referredBy ? el('p', {}, 'Invited by ', el('b', { title: r.referredBy }, short(r.referredBy)), r.inbound ? '' : ' · historical relationship; complete fresh MEDIUM/HARD training to activate Convoy.')
        : el('form', { class: 'promo-form', onsubmit: e => { e.preventDefault(); act(async () => { await api('referrals/bind', { code: input.value.trim().toUpperCase() }, { report: false }); say('Invite applied.', 'good'); }); } }, input, el('button', { id: 'ref-apply', type: 'submit', disabled: busy }, 'APPLY INVITE')),
      r.inbound ? el('div', { id: 'ref-progress' }, el('h2', { class: 'sub' }, 'YOUR CONVOY STEPS'), invite(r.inbound)) : '',
      el('p', { class: 'dim' }, 'Your first activated friend unlocks this paint for your truck. Your friend may receive one unranked 1h promo, subject to caps.'),
      el('div', { class: 'ref-gifts', role: 'group', 'aria-label': 'gift colour' }, ...GIFT_ITEMS.map(id => el('button', {
        type: 'button', class: r.gift === id ? 'on' : '', 'aria-pressed': String(r.gift === id), disabled: busy || r.gift === id,
        onclick: () => act(async () => { await api('referrals/gift', { item: id }, { report: false }); say(`${itemName(id)} selected.`, 'good'); }),
      }, el('i', { class: 'ref-sw', style: `background:linear-gradient(${LOOKS.truck_color[id].top},${LOOKS.truck_color[id].bottom})`, 'aria-hidden': 'true' }), itemName(id)))),
      el('h2', { class: 'sub' }, 'INVITES'),
      el('div', { id: 'ref-invites' }, r.invites.length ? r.invites.map(invite) : el('p', { class: 'dim' }, 'No invites yet.')),
      r.legacyQualified ? el('p', { class: 'dim' }, `${r.legacyQualified} historical badge-counted friends retained. Each friend counts once toward your badge.`) : '',
      el('h2', { class: 'sub' }, 'YOUR REWARDS'),
      el('div', { id: 'ref-rewards' }, r.rewards.length ? r.rewards.map(reward => el('div', { class: 'card' },
        el('b', {}, `${reward.kind.toUpperCase()} · ${reward.state.toUpperCase()}`), ` · ${short(reward.referee)}`,
        el('p', {}, reward.state === 'paid' ? `${Number(reward.paidUnits) / 1e6} TEN4 paid` : `${reward.amount} TEN4 base`, reward.releaseAt ? ` · eligible after ${when(reward.releaseAt)}` : '', reward.reason ? ` · ${reward.reason}` : ''),
        reward.signature ? el('p', { class: 'dim', style: 'overflow-wrap:anywhere' }, `Transaction ${reward.signature}`) : '')) : el('p', { class: 'dim' }, 'No milestone rewards yet.')),
      el('h2', { class: 'sub' }, 'CONVOY LEADERBOARD'),
      el('label', {}, el('input', { id: 'ref-hidden', type: 'checkbox', checked: r.hidden, disabled: busy, onchange: e => act(async () => { await api('me/privacy', { convoyHidden: e.target.checked }, { method: 'PATCH', report: false }); say('Visibility saved.', 'good'); }) }), ' Hide me from the public Convoy leaderboard'),
      board ? el('div', { id: 'ref-board' }, el('p', {}, `You: ${board.me.qualified} qualified · ${board.me.active} active${board.me.hidden ? ' · hidden' : ''}`),
        board.rows.length ? board.rows.map(p => el('p', {}, `${p.rank}. ${p.displayName === p.wallet ? short(p.wallet) : p.displayName} · ${p.qualified} qualified · ${p.active} active`)) : el('p', { class: 'dim' }, 'No public Convoys yet.')) : el('p', { class: 'dim' }, 'Leaderboard unavailable.'));
  };
  const load = async () => {
    try {
      const [next, leaders] = await Promise.all([api('referrals', undefined, { report: false }), api('referrals/leaderboard', undefined, { report: false }).catch(() => null)]);
      if (!alive()) return;
      row = next; board = leaders; paint();
    } catch (e) { if (alive()) { say(e.message, 'bad'); if (!row) box.replaceChildren(el('button', { type: 'button', onclick: load }, 'RETRY CONVOY')); } }
  };
  load();
  return [el('h2', {}, 'CONVOY REFERRALS'), box, note];
}
