import { el } from './dom.js';
import { LOOKS } from '../js/cosmetics.js';

/* The PROMO CODES section of the lobby's PROFILE (docs/promocodes.md): what this wallet redeemed – the parts themselves live in the GARAGE tab (lobby-garage.js, which reuses the names + swatches below).
   Pure builders: lobby.js owns the state and the API calls and hands in callbacks. Server text (codes, descriptions) goes in with textContent only. */

export const SLOT_NAME = { wheel: 'STEERING WHEEL', truck_color: 'TRUCK PAINT', gearbox: 'SHIFTER', dice: 'HANGING DICE', needle: 'GAUGE NEEDLES', ornament: 'HOOD ORNAMENT', dash: 'DASHBOARD', indicator: 'INDICATORS', phone: 'PHONE' };
const ITEM_NAME = {
  classic: 'Classic', crimson: 'Crimson', ocean: 'Ocean', moss: 'Moss', gold: 'Gold', ivory: 'Ivory',
  red: 'Red', blue: 'Blue', green: 'Green', black: 'Black', yellow: 'Yellow', white: 'White',
  convoy: 'Convoy', signal: 'Signal',
  stick: 'Stock', chrome: 'Chrome', wood: 'Wood', racing: 'Racing', carbon: 'Carbon',
  pink: 'Pink', orange: 'Orange', lime: 'Lime', cyan: 'Cyan',
  spear: 'Spear', ball: 'Ball', star: 'Star', bird: 'Bird', flag: 'Flag',
  stock: 'Stock', amber: 'Amber', ice: 'Ice', silver: 'Silver', clear: 'Clear',
};
export const itemName = item => ITEM_NAME[item] ?? item;
const KIND_ICON = { ride: '⛟', tickets: '🎟', free_rides: '⛟', cosmetic: '✦' };

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
  if (slot === 'dice') return el('span', { class: 'sw dice', style: `background:${l.body};color:${l.pip}` }, '⠿');
  if (slot === 'needle') return el('span', { class: 'sw needle', style: `--n:${l.color}` });
  if (slot === 'ornament') return el('span', { class: 'sw', style: `background:${l.fill};box-shadow:inset 0 0 0 2px ${l.edge}` });
  if (slot === 'dash') return el('span', { class: 'sw hood', style: `background:linear-gradient(${l.top},${l.bottom});border-color:${l.bottom}` });
  if (slot === 'indicator') return el('span', { class: 'sw', style: `background:${l.bezel};border-radius:4px` });
  if (slot === 'phone') return el('span', { class: 'sw', style: `background:${l.frame};box-shadow:inset 0 0 0 2px ${l.edge};border-radius:7px` });
  return el('span', { class: 'sw knob', style: `background:${l.knob};border-color:${l.rim}` });
}
