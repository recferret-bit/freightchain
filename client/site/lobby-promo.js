import { el } from './dom.js';
import { COSMETICS, LOOKS, SLOTS } from '../js/cosmetics.js';

/* The lobby's PROMO tab (docs/promocodes.md): the code form, what this wallet redeemed, and the wardrobe – every cosmetic a code unlocked (steering wheel, truck paint, shifter), one click to wear it.
   Pure builders: lobby.js owns the state and the API calls and hands in callbacks. Server text (codes, descriptions) goes in with textContent only. */

export const SLOT_NAME = { wheel: 'STEERING WHEEL', truck_color: 'TRUCK PAINT', gearbox: 'SHIFTER' };
const ITEM_NAME = {
  classic: 'Classic', crimson: 'Crimson', ocean: 'Ocean', moss: 'Moss', gold: 'Gold', ivory: 'Ivory',
  red: 'Red', blue: 'Blue', green: 'Green', black: 'Black', yellow: 'Yellow', white: 'White',
  stick: 'Stock', chrome: 'Chrome', wood: 'Wood', racing: 'Racing', carbon: 'Carbon',
};
export const itemName = item => ITEM_NAME[item] ?? item;
const KIND_ICON = { tickets: '🎟', free_rides: '⛟', cosmetic: '✦' };

/** The code field (also on NEW RIDE: same ids, only one is on the page at a time). `value` pre-fills it – a code from the landing's invite block. */
export function promoForm({ onSubmit, value = '', hint = 'Got a code? It gives free rides, free tickets or a new look for your wheel, truck paint or shifter.' }) {
  return el('form', { class: 'card promo', id: 'promo', onsubmit: onSubmit },
    el('label', { for: 'promo-code' }, hint),
    el('div', { class: 'row' },
      el('input', { id: 'promo-code', name: 'code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 64, placeholder: 'e.g. WELCOME', value, 'aria-describedby': 'promo-msg' }),
      el('button', { id: 'promo-go', type: 'submit' }, 'REDEEM')),
    el('p', { class: 'msg dim', id: 'promo-msg', role: 'status' }));
}

/** GET /api/promo/mine → the list. */
export function redemptionList(rows) {
  if (!rows.length) return el('div', { class: 'card empty', id: 'my-codes' }, 'No codes redeemed yet.');
  return el('div', { class: 'hist', id: 'my-codes' }, rows.map(r => el('div', { class: 'hrow' },
    el('span', {}, el('span', { class: 'ic', 'aria-hidden': 'true' }, KIND_ICON[r.kind] ?? '•'), ' ', el('b', {}, r.code), ' · ', r.label, r.description ? el('span', { class: 'dim' }, ` · ${r.description}`) : ''),
    el('span', { class: 'dim' }, new Date(r.at).toLocaleString()))));
}

/** A small picture of one item from its palette (colours only – the real thing is drawn in the cockpit). */
export function swatch(slot, item) {
  const l = LOOKS[slot]?.[item];
  if (!l) return el('span', { class: 'sw' });
  if (slot === 'truck_color') return el('span', { class: 'sw hood', style: `background:linear-gradient(${l.top},${l.bottom});border-color:${l.frame}` });
  if (slot === 'wheel') return el('span', { class: 'sw wheel', style: `border-color:${l.rim};box-shadow:inset 0 0 0 3px ${l.sheen};background:radial-gradient(circle,${l.hub} 0 28%,${l.spoke} 29% 100%)` });
  return el('span', { class: 'sw knob', style: `background:${l.knob};border-color:${l.rim}` });
}

/** GET /api/wardrobe → one row per slot: every item of the catalog, worn / owned / locked. `onEquip(slot, item)`; `busy` disables the buttons while a call runs. */
export function wardrobe(w, onEquip, busy = false) {
  return el('div', { id: 'wardrobe' }, SLOTS.map(slot => el('div', { class: 'card slot', 'data-slot': slot },
    el('div', { class: 'lbl' }, SLOT_NAME[slot] ?? slot),
    el('div', { class: 'items' }, COSMETICS[slot].map(item => {
      const owned = w.unlocked[slot]?.includes(item), worn = w.equipped[slot] === item;
      return el('button', {
        class: `item${worn ? ' on' : ''}${owned ? '' : ' lock'}`, 'data-item': item, disabled: busy || !owned || worn, 'aria-pressed': String(worn),
        title: owned ? (worn ? 'you wear this' : `wear ${itemName(item).toLowerCase()}`) : 'locked – a promo code unlocks it', onclick: () => onEquip(slot, item),
      }, swatch(slot, item), el('span', { class: 'nm' }, itemName(item)), el('span', { class: 'st' }, worn ? 'WORN' : owned ? 'WEAR' : '🔒'));
    })))));
}
