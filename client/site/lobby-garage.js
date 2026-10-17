import { el } from './dom.js';
import { REFERRAL_PAINTS, SLOTS } from '../js/cosmetics.js';
import { SLOT_NAME, itemName, swatch } from './lobby-promo.js';

/* The Garage (lobby → GARAGE, docs/garage.md): every part, owned or locked, can be observed on the real cab. APPLY still sends only the owned pick
   (POST /api/garage/loadout). A locked part is minted by burning HONK (POST /api/honk/visuals – lobby.js). Pure builders: lobby.js owns the state and the API calls.
   Server text (names, descriptions, codes, prices) goes in with textContent only. Price and description come from the garage payload; the catalog is only a price backup. */

/** Has the player picked something other than what is saved? */
export const dirty = (garage, pick) => SLOTS.some(slot => pick[slot] !== garage.equipped[slot]);

/** "12 of 48 parts collected" + a bar + one line per slot. The numbers come from the garage payload. */
export function garageProgress(g) {
  const { collected, total, percent } = g.progress;
  return el('div', { class: 'card gprog', id: 'garage-progress' },
    el('div', { class: 'lbl' }, 'COLLECTION'),
    el('div', { class: 'big' }, `${collected} / ${total}`, el('small', {}, ` parts · ${percent}%`)),
    el('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(percent), 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('i', { style: `width:${percent}%` })),
    el('div', { class: 'gslots' }, g.slots.map(s => el('span', { 'data-slot': s.slot }, `${SLOT_NAME[s.slot] ?? s.slot} `, el('b', {}, `${s.collected}/${s.total}`)))),
    el('p', { class: 'dim' }, collected === total ? 'Every part collected – the garage is complete.' : 'Locked parts are minted by burning HONK; referral paints come from invites.'));
}

const badge = (part, picked) => (!part.owned ? '🔒' : picked ? (part.worn ? 'WORN' : 'SELECTED') : 'SELECT');
const partTitle = part => (typeof part.name === 'string' && part.name.trim() ? part.name : itemName(part.id));
/** A price or balance the server actually sent. Never a stand-in. */
const knownPrice = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() ? v.trim() : null);
/** Garage payload first. Catalog only when a non-default part arrived without a price. */
const priceOf = (part, slot, catalog) => {
  if (part.isDefault) return null;
  const own = knownPrice(part.price);
  if (own) return own;
  const row = Array.isArray(catalog) ? catalog.find(r => r && r.slot === slot && r.item === part.id) : null;
  return row ? knownPrice(row.price) : null;
};
const referralPaint = (slot, part) => slot === 'truck_color' && REFERRAL_PAINTS.includes(part.id);
const origin = (part, slot) => {
  if (part.isDefault) return 'Everybody has this one.';
  const when = part.unlockedAt ? new Date(part.unlockedAt).toLocaleDateString() : '';
  if (referralPaint(slot, part)) return part.owned ? `Referral gift · ${when}` : 'Locked – finish a verified ride through an invite to earn this paint.';
  if (part.owned && String(part.code || '').startsWith('honk:')) return when ? `Minted by burning HONK · ${when}` : 'Minted by burning HONK';
  if (part.owned) return `Unlocked by ${part.code} · ${when}`;
  return 'Locked – burn HONK to mint it.';
};

/** The part `observe` ({ slot, id }) points at, or null. */
export function partAt(garage, observe) {
  if (!observe) return null;
  const group = garage?.slots?.find(s => s.slot === observe.slot);
  const part = group?.parts?.find(p => p.id === observe.id);
  return part ? { slot: observe.slot, part } : null;
}

/** What the cab draws: the owned pick, with a locked observation laid on its slot. That id stays out of the pick APPLY sends. */
export function previewLoadout(garage, pick, observe) {
  const look = { ...pick };
  const seen = partAt(garage, observe);
  if (seen && !seen.part.owned) look[seen.slot] = seen.part.id;
  return look;
}

/** The card above the slots. Rebuilt on every paint. `balance` null = omit it (the honk request failed, or has not answered). */
export function garageDetail({ garage, observe, catalog = null, balance = null, busy = false, onBurn = () => {} }) {
  const held = knownPrice(balance);
  const head = held ? el('p', { class: 'dim bal', id: 'garage-honk' }, `You hold ${held} HONK.`) : null;
  const seen = partAt(garage, observe);
  if (!seen) return el('div', { class: 'card', id: 'garage-detail' }, head, el('p', { class: 'dim' }, 'Choose a part.'));
  const { slot, part } = seen;
  const price = priceOf(part, slot, catalog);
  const lines = [head, el('p', { class: 'nm' }, partTitle(part))];
  if (typeof part.description === 'string' && part.description.trim()) lines.push(el('p', { class: 'desc' }, part.description));
  if (part.isDefault) lines.push(el('p', { class: 'dim' }, 'Included. Everybody has this one.'));
  else if (referralPaint(slot, part)) lines.push(el('p', { class: 'dim' }, origin(part, slot)));
  else {
    lines.push(el('p', { class: 'price' }, price ? `Burns ${price} HONK` : 'The price is unavailable.'));
    if (part.owned) lines.push(el('p', { class: 'dim' }, origin(part, slot)));
    else {
      lines.push(el('p', { class: 'dim' }, 'Preview only. Burn HONK to keep it.'));
      lines.push(el('button', {
        type: 'button', class: 'ghost honk-burn', id: 'garage-burn', 'data-burn': part.id, disabled: !!busy || !price,
        onclick: () => { if (price && !busy) onBurn(slot, part); },
      }, price ? `BURN ${price} HONK` : 'BURN HONK'));
    }
  }
  return el('div', { class: 'card', id: 'garage-detail' }, ...lines);
}

/** One card per slot. `observe` marks the part being inspected; `pick` is only owned ids. A click always calls `onPick`, locked included. */
export function garageSlots(g, pick, onPick, onHover = () => {}, opt = {}) {
  const { catalog = null, observe = null } = opt;
  return el('div', { id: 'garage-slots' }, g.slots.map(s => el('div', { class: 'card slot', 'data-slot': s.slot, onpointerenter: e => { if (e.pointerType === 'mouse') onHover(s.slot); }, onpointerleave: () => onHover(null), onfocusin: () => onHover(s.slot), onfocusout: () => onHover(null) },
    el('div', { class: 'lbl' }, SLOT_NAME[s.slot] ?? s.slot, el('b', { class: 'cnt' }, ` ${s.collected}/${s.total}`)),
    el('div', { class: 'items' }, s.parts.map(part => {
      const picked = pick[s.slot] === part.id;
      const watching = !!observe && observe.slot === s.slot && observe.id === part.id;
      const price = priceOf(part, s.slot, catalog);
      return el('button', {
        class: `item${picked ? ' on' : ''}${watching ? ' obs' : ''}${part.worn ? ' saved' : ''}${part.owned ? '' : ' lock'}`, type: 'button', 'data-item': part.id,
        'aria-pressed': String(picked), 'aria-current': watching ? 'true' : null, title: origin(part, s.slot), onclick: () => onPick(s.slot, part),
      }, swatch(s.slot, part.id), el('span', { class: 'nm' }, partTitle(part)), el('span', { class: 'st' }, badge(part, picked)),
        part.isDefault ? null : referralPaint(s.slot, part) ? el('span', { class: 'pr' }, 'Referral gift') : el('span', { class: 'pr' }, price ? `Burns ${price} HONK` : 'Price unavailable'));
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
