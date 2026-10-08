import { el } from './dom.js';
import { COSMETICS, LOOKS, SLOTS } from '../js/cosmetics.js';
import { SLOT_NAME, itemName, swatch } from './lobby-promo.js';

/* The Garage (lobby → GARAGE, docs/garage.md): every part of the catalog with what this wallet owns, how it was earned, the collection progress, a preview of the cockpit with the
   parts picked, and SAVE (POST /api/garage/loadout – stored in the database, the next ride starts with it). Pure builders: lobby.js owns the state and the API calls.
   Server text (codes) goes in with textContent only; the preview is built with createElementNS, never innerHTML. */

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of kids) if (c != null) n.append(c);
  return n;
};

/** Has the player picked something other than what is saved? */
export const dirty = (garage, pick) => SLOTS.some(slot => pick[slot] !== garage.equipped[slot]);

/** "12 of 25 parts collected" + a bar + one line per slot. */
export function garageProgress(g) {
  const { collected, total, percent } = g.progress;
  return el('div', { class: 'card gprog', id: 'garage-progress' },
    el('div', { class: 'lbl' }, 'COLLECTION'),
    el('div', { class: 'big' }, `${collected} / ${total}`, el('small', {}, ` parts · ${percent}%`)),
    el('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(percent), 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('i', { style: `width:${percent}%` })),
    el('div', { class: 'gslots' }, g.slots.map(s => el('span', { 'data-slot': s.slot }, `${SLOT_NAME[s.slot] ?? s.slot} `, el('b', {}, `${s.collected}/${s.total}`)))),
    el('p', { class: 'dim' }, collected === total ? 'Every part collected – the garage is complete.' : 'Parts come from promo codes: redeem one on the PROMO tab and the part lands here.'));
}

/** A drawing of the cockpit with the picked parts (colours only – the same palettes the game uses). */
export function garagePreview(pick) {
  const L = slot => LOOKS[slot][pick[slot]] ?? LOOKS[slot][COSMETICS[slot][0]];
  const paint = L('truck_color'), wl = L('wheel'), gb = L('gearbox'), dc = L('dice'), nd = L('needle');
  return el('div', { class: 'card gprev', id: 'garage-preview' }, svg('svg', { viewBox: '0 0 300 170', role: 'img', 'aria-label': 'cockpit preview' },
    svg('rect', { width: 300, height: 170, fill: '#26221d' }),
    svg('path', { d: 'M40 12 H260 L272 104 Q150 92 28 104 Z', fill: '#8ec3e8', 'fill-opacity': '.35', stroke: paint.frame, 'stroke-width': 3 }),
    svg('path', { d: 'M96 104 L132 74 H168 L204 104 Z', fill: paint.top }), svg('path', { d: 'M96 104 L204 104 L220 112 L80 112 Z', fill: paint.fender }),
    svg('rect', { x: 0, y: 108, width: 300, height: 62, fill: '#14120f' }), svg('path', { d: 'M0 108 Q150 96 300 108', fill: 'none', stroke: paint.dashEdge, 'stroke-width': 2 }),
    svg('circle', { cx: 112, cy: 128, r: 17, fill: '#e8e2cf' }), svg('path', { d: 'M112 128 L124 117', stroke: nd.color, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
    svg('circle', { cx: 160, cy: 128, r: 17, fill: '#e8e2cf' }), svg('path', { d: 'M160 128 L148 138', stroke: nd.color, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
    svg('circle', { cx: 150, cy: 172, r: 40, fill: 'none', stroke: wl.rim, 'stroke-width': 11 }), svg('circle', { cx: 150, cy: 172, r: 40, fill: 'none', stroke: wl.sheen, 'stroke-width': 5 }),
    svg('circle', { cx: 150, cy: 172, r: 12, fill: wl.hub }), svg('circle', { cx: 150, cy: 132, r: 2.4, fill: wl.mark }),
    svg('path', { d: 'M244 160 L252 124', stroke: gb.lever ?? '#c9ced3', 'stroke-width': 3, 'stroke-linecap': 'round' }), svg('circle', { cx: 252, cy: 122, r: 7, fill: gb.knob, stroke: gb.rim, 'stroke-width': 1 }),
    svg('path', { d: 'M62 12 V40', stroke: '#ddd', 'stroke-width': 1 }), svg('rect', { x: 55, y: 40, width: 14, height: 14, rx: 2, fill: dc.body }), svg('circle', { cx: 60, cy: 45, r: 1.6, fill: dc.pip }), svg('circle', { cx: 64, cy: 50, r: 1.6, fill: dc.pip }),
  ));
}

const badge = (part, picked) => (!part.owned ? '🔒' : picked ? (part.worn ? 'WORN' : 'SELECTED') : 'SELECT');
const origin = part => (part.isDefault ? 'Everybody has this one.' : part.owned ? `Unlocked by ${part.code} · ${new Date(part.unlockedAt).toLocaleDateString()}` : 'Locked – a promo code unlocks it.');

/** One card per slot; `pick` = what is selected now, `onPick(slot, part)` for every click (locked ones too – the lobby explains them). */
export function garageSlots(g, pick, onPick) {
  return el('div', { id: 'garage-slots' }, g.slots.map(s => el('div', { class: 'card slot', 'data-slot': s.slot },
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
    el('button', { id: 'garage-save', disabled: !changed || busy, onclick: onSave }, busy ? 'SAVING…' : 'SAVE LOADOUT'),
    el('button', { id: 'garage-reset', class: 'ghost', disabled: !changed || busy, onclick: onReset }, 'RESET'),
    el('span', { class: 'dim' }, changed ? 'Not saved yet.' : 'Saved – your next ride starts with this loadout.'),
    el('p', { class: 'msg dim', id: 'garage-msg', role: 'status' }));
}
