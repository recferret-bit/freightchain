import { el } from './dom.js';
import { LOOKS } from '../js/cosmetics.js';
import { itemName } from './lobby-promo.js';
import { GIFT_ITEMS, availableText, capacityText, inviteLabel, shareUrl } from './referral.js';

/* The REFERRALS block of the lobby PROFILE, next to promo codes. Pure numbers live in referral.js.
   Server text (code, wallets, statuses) goes in through el(), which sets text nodes, never markup. */

const when = at => {
  if (typeof at !== 'string' && typeof at !== 'number') return '';
  const d = new Date(at);
  return Number.isNaN(+d) ? '' : d.toLocaleDateString();
};

export function referralSection({ api, short, base, origin, alive = () => true }) {
  const box = el('div', { id: 'ref-box' }, el('p', { class: 'dim' }, 'Loading…'));
  const note = el('p', { class: 'msg dim', id: 'ref-msg', role: 'status' });
  let row = null, busy = false;
  const say = (text, cls = 'dim') => { note.textContent = text; note.className = `msg ${cls}`; };

  const paint = () => {
    const r = row ?? {};
    const code = typeof r.code === 'string' ? r.code : '';
    const url = code ? shareUrl(base, origin, code) : '';
    const invites = Array.isArray(r.invites) ? r.invites : [];
    box.replaceChildren(
      el('div', { class: 'ref-head' },
        el('b', { class: 'ref-code', id: 'ref-code' }, code || '–'),
        url ? el('button', { type: 'button', class: 'ghost', id: 'ref-copy', onclick: () => copy(url) }, 'COPY LINK') : ''),
      url ? el('p', { class: 'dim ref-url' }, url) : '',
      el('p', { class: 'ref-meta' },
        el('span', {}, 'Used ', el('b', {}, capacityText(r))),
        el('span', {}, 'Open ', el('b', {}, availableText(r)))),
      typeof r.referredBy === 'string' && r.referredBy ? el('p', { class: 'dim' }, 'Invited by ', el('b', { title: r.referredBy }, short(r.referredBy))) : '',
      el('p', { class: 'dim' }, 'Gift colour for a friend who qualifies. They wear it when they still have the red truck.'),
      el('div', { class: 'ref-gifts', role: 'group', 'aria-label': 'gift colour' }, ...GIFT_ITEMS.map(id => el('button', {
        type: 'button',
        class: r.gift === id ? 'on' : '',
        'aria-pressed': r.gift === id ? 'true' : 'false',
        disabled: busy || r.gift === id,
        onclick: () => pick(id),
      }, el('i', { class: 'ref-sw', style: `background:linear-gradient(${LOOKS.truck_color[id].top},${LOOKS.truck_color[id].bottom})`, 'aria-hidden': 'true' }), itemName(id)))),
      el('h2', { class: 'sub' }, 'INVITES'),
      invites.length ? el('div', { class: 'hist', id: 'ref-invites' }, invites.map(inv => {
        const wallet = typeof inv?.wallet === 'string' ? inv.wallet : '';
        const day = when(inv?.at);
        return el('div', { class: 'hrow' },
          el('span', { title: wallet }, wallet ? short(wallet) : '–'),
          el('span', {}, inviteLabel(inv?.status), day ? ` · ${day}` : ''));
      })) : el('div', { class: 'card empty' }, 'No invites yet.'));
  };

  const copy = async url => {
    try { await navigator.clipboard.writeText(url); say('Link copied.', 'good'); }
    catch { say('Copy failed – select the link and copy it.', 'bad'); }
  };

  const pick = async item => {
    if (busy || !row || row.gift === item) return;
    busy = true; paint();
    try {
      await api('referrals/gift', { item }, { report: false });
      row = { ...row, gift: item };
      if (alive()) say(`${itemName(item)} is the gift colour now.`, 'good');
    } catch (e) { if (alive()) say(e.message, 'bad'); }
    busy = false;
    if (alive()) paint();
  };

  const load = async () => {
    try { row = await api('referrals', undefined, { report: false }); }
    catch (e) { if (alive()) box.replaceChildren(el('p', { class: 'bad' }, `Could not load referrals (${e.message}).`)); return; }
    if (!alive()) return;
    paint();
  };
  load();
  return [el('h2', {}, 'REFERRALS'), box, note];
}
