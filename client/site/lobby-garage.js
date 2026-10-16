import { el } from './dom.js';
import { SLOTS } from '../js/cosmetics.js';
import { SLOT_NAME, itemName, swatch } from './lobby-promo.js';

/* The Garage (lobby → GARAGE, docs/garage.md): every part of the catalog with what this wallet owns, how it was earned, the collection progress, the real cab (site/garage-cab.js: the game's own
   cockpit renderer, parts switch live), and APPLY (POST /api/garage/loadout – stored in the database, the next ride starts with it). Pure builders: lobby.js owns the state and the API calls.
   Server text (codes) goes in with textContent only. */

/** Has the player picked something other than what is saved? */
export const dirty = (garage, pick) => SLOTS.some(slot => pick[slot] !== garage.equipped[slot]);

/** "12 of 28 parts collected" + a bar + one line per slot. The numbers come from the garage payload. */
export function garageProgress(g) {
  const { collected, total, percent } = g.progress;
  return el('div', { class: 'card gprog', id: 'garage-progress' },
    el('div', { class: 'lbl' }, 'COLLECTION'),
    el('div', { class: 'big' }, `${collected} / ${total}`, el('small', {}, ` parts · ${percent}%`)),
    el('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(percent), 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('i', { style: `width:${percent}%` })),
    el('div', { class: 'gslots' }, g.slots.map(s => el('span', { 'data-slot': s.slot }, `${SLOT_NAME[s.slot] ?? s.slot} `, el('b', {}, `${s.collected}/${s.total}`)))),
    el('p', { class: 'dim' }, collected === total ? 'Every part collected – the garage is complete.' : 'Parts come from promo codes: redeem one in your profile and the part lands here.'));
}

const badge = (part, picked) => (!part.owned ? '🔒' : picked ? (part.worn ? 'WORN' : 'SELECTED') : 'SELECT');
const origin = part => (part.isDefault ? 'Everybody has this one.' : part.owned ? `Unlocked by ${part.code} · ${new Date(part.unlockedAt).toLocaleDateString()}` : 'Locked – a promo code unlocks it.');

/** One card per slot; `pick` = what is selected now, `onPick(slot, part)` for every click (locked ones too – the lobby explains them). */
export function garageSlots(g, pick, onPick, onHover = () => {}) {
  return el('div', { id: 'garage-slots' }, g.slots.map(s => el('div', { class: 'card slot', 'data-slot': s.slot, onpointerenter: e => { if (e.pointerType === 'mouse') onHover(s.slot); }, onpointerleave: () => onHover(null), onfocusin: () => onHover(s.slot), onfocusout: () => onHover(null) },
    el('div', { class: 'lbl' }, SLOT_NAME[s.slot] ?? s.slot, el('b', { class: 'cnt' }, ` ${s.collected}/${s.total}`)),
    el('div', { class: 'items' }, s.parts.map(part => {
      const picked = pick[s.slot] === part.id;
      return el('button', {
        class: `item${picked ? ' on' : ''}${part.worn ? ' saved' : ''}${part.owned ? '' : ' lock'}`, type: 'button', 'data-item': part.id, 'aria-pressed': String(picked),
        title: origin(part), onclick: () => onPick(s.slot, part),
      }, swatch(s.slot, part.id), el('span', { class: 'nm' }, itemName(part.id)), el('span', { class: 'st' }, badge(part, picked)));
    })))));
}

export function garageActions({ garage, pick, busy, onSave, onReset }) {
  const changed = dirty(garage, pick);
  return el('div', { class: 'actions', id: 'garage-actions' },
    el('button', { id: 'garage-save', disabled: !changed || busy, onclick: onSave }, busy ? 'APPLYING…' : 'APPLY'),
    el('button', { id: 'garage-reset', class: 'ghost', disabled: !changed || busy, onclick: onReset }, 'RESET'),
    el('span', { class: 'dim' }, changed ? 'Not applied yet.' : 'Applied – your next ride starts with this loadout.'),
    el('p', { class: 'msg dim', id: 'garage-msg', role: 'status' }));
}
