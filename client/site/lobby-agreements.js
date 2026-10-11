/* The two boxes on PROFILE. Off until the rider ticks them. The server stores the stamps; this only paints and PUTs. */
import { el } from './dom.js';
import { api } from './wallet.js';
import { track } from '../js/analytics.js';

/** Both boxes on. Paid buttons read this off S.me so they do not fetch the profile again. */
export const offerAccepted = (me) => !!(me?.agreements?.age18 && me?.agreements?.loss);

/** A paid click while the boxes are off. The profile card says why; the click itself is not a buy. */
export function blockPaid(me) {
  if (offerAccepted(me)) return false;
  location.hash = '#profile';
  return true;
}

const NOTE_ON = 'Both boxes are on. SOL spent on a paid shift can be lost. A prize is not guaranteed.';
const NOTE_OFF = 'Tick both before a paid shift. A paid button sends you here until they are on.';

/** The PROFILE card. `me` is S.me: a successful PUT writes `me.agreements` so NEW RIDE sees it. */
export function agreementsCard(me) {
  const flags = { age18: !!me?.agreements?.age18, loss: !!me?.agreements?.loss };
  const age = el('input', { type: 'checkbox', id: 'agree-age', checked: flags.age18 });
  const loss = el('input', { type: 'checkbox', id: 'agree-loss', checked: flags.loss });
  const note = el('p', { id: 'offer-note', class: offerAccepted(me) ? 'dim' : 'bad' }, offerAccepted(me) ? NOTE_ON : NOTE_OFF);
  const paint = () => {
    note.textContent = offerAccepted(me) ? NOTE_ON : NOTE_OFF;
    note.className = offerAccepted(me) ? 'dim' : 'bad';
  };
  const flip = (kind, box) => {
    age.disabled = loss.disabled = true; // one PUT at a time, so two fast ticks cannot store a torn pair
    const next = { age18: age.checked, loss: loss.checked };
    track('agreement_toggled', { kind, on: box.checked });
    api('profile/agreements', next, { method: 'PUT' }).then((saved) => { me.agreements = saved; paint(); }, () => { box.checked = !box.checked; }).finally(() => { age.disabled = loss.disabled = false; });
  };
  age.addEventListener('change', () => flip('age18', age));
  loss.addEventListener('change', () => flip('loss', loss));
  return el('div', { class: 'card', id: 'offer' },
    el('h2', {}, 'BEFORE A PAID SHIFT'),
    note,
    el('label', { class: 'opt' }, age, el('span', {}, el('b', {}, 'I AM 18 OR OLDER'), el('small', {}, 'Required before any shift that spends SOL.'))),
    el('label', { class: 'opt' }, loss, el('span', {}, el('b', {}, 'SOL SPENT ON A SHIFT CAN BE LOST'), el('small', {}, 'A prize is not guaranteed. This is not a deposit or an investment. This build is Solana devnet.'))));
}
