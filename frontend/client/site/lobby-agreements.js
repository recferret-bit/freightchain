/* The two boxes on PROFILE. Off until the rider ticks them. The server stores the stamps; this only paints and PUTs. */
import { el } from './dom.js';
import { api } from './wallet.js';
import { t } from './i18n.js';
import { track } from '../js/analytics.js';

/** Both boxes on. Paid buttons read this off S.me so they do not fetch the profile again. */
export const offerAccepted = (me) => !!(me?.agreements?.age18 && me?.agreements?.loss);

/** A paid click while the boxes are off. The profile card says why; the click itself is not a buy. */
export function blockPaid(me) {
  if (offerAccepted(me)) return false;
  location.hash = '#profile';
  return true;
}

const translated = (tag, key) => el(tag, { 'data-i18n': key }, t(key));

/** The PROFILE card. `me` is S.me: a successful PUT writes `me.agreements` so NEW RIDE sees it. */
export function agreementsCard(me) {
  if (offerAccepted(me)) return null;
  const flags = { age18: !!me?.agreements?.age18, loss: !!me?.agreements?.loss };
  const age = el('input', { type: 'checkbox', id: 'agree-age', checked: flags.age18 });
  const loss = el('input', { type: 'checkbox', id: 'agree-loss', checked: flags.loss });
  const note = el('p', { id: 'offer-note', class: 'bad', 'data-i18n': 'offer.off' }, t('offer.off'));
  const paint = () => {
    const accepted = offerAccepted(me);
    const key = accepted ? 'offer.on' : 'offer.off';
    note.setAttribute('data-i18n', key);
    note.textContent = t(key);
    note.className = accepted ? 'dim' : 'bad';
    if (accepted) age.disabled = loss.disabled = true;
  };
  let inFlight = null;
  let queued = false;
  const sync = () => {
    if (inFlight) { queued = true; return; }
    const next = { age18: age.checked, loss: loss.checked };
    inFlight = api('profile/agreements', next, { method: 'PUT' })
      .then((saved) => {
        me.agreements = saved;
        paint();
      })
      .catch(() => {
        age.checked = !!me?.agreements?.age18;
        loss.checked = !!me?.agreements?.loss;
        queued = false;
        paint();
      })
      .finally(() => {
        inFlight = null;
        if (queued && !offerAccepted(me)) {
          queued = false;
          sync();
        } else {
          queued = false;
        }
      });
  };
  const flip = (kind, box) => {
    if (offerAccepted(me)) { box.checked = true; return; }
    track('agreement_toggled', { kind, on: box.checked });
    sync();
  };
  age.addEventListener('change', () => flip('age18', age));
  loss.addEventListener('change', () => flip('loss', loss));
  return el('div', { class: 'card', id: 'offer' },
    translated('h2', 'offer.title'),
    note,
    el('label', { class: 'opt' }, age, el('span', {}, translated('b', 'offer.age'), translated('small', 'offer.ageHint'))),
    el('label', { class: 'opt' }, loss, el('span', {}, translated('b', 'offer.loss'), translated('small', 'offer.lossHint'))));
}
