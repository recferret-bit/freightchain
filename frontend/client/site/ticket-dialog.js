import { el } from './dom.js';

/* The paid-ticket result, a dialog over the lobby. Success is a Solana-coloured ticket (purple → green) with the on-chain receipt and POST ON 𝕏.
   A refusal is the same ticket, slumped and grey. The card under it keeps the sentence too.
   Not <dialog>.showModal(): that makes the lobby inert, and the e2e suites click the next card with the result still up (busy() closes it). */
const NS = 'http://www.w3.org/2000/svg';
let back = null;   // the element focused before the dialog opened

const bars = (fill, w = 40) => {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 44 28'); s.setAttribute('width', String(w)); s.setAttribute('height', String(Math.round(w * 0.65))); s.setAttribute('aria-hidden', 'true');
  const g = document.createElementNS(NS, 'g'); g.setAttribute('fill', fill);
  for (const y of [2, 11, 20]) { const p = document.createElementNS(NS, 'polygon'); p.setAttribute('points', `10,${y} 40,${y} 34,${y + 6} 4,${y + 6}`); g.append(p); }
  s.append(g); return s;
};
const link = (href, text, title = '') => el('a', { href, target: '_blank', rel: 'noopener', title: title || null }, text);

function onKey(e) { if (e.key === 'Escape') hideTicketDialog(); }

/** Purchase gate: last start in local time, EN and RU burn copy, checkbox required before the order is sent. */
export function confirmBurnWarning(pool) {
  const last = pool?.lastStartAt ?? (pool?.playDeadline ? pool.playDeadline - 75 * 60_000 : Date.now());
  const when = new Date(last);
  const local = when.toLocaleString();
  const left = Math.max(0, when.getTime() - Date.now());
  return new Promise((resolve) => {
    const n = host();
    const box = el('input', { id: 'burn-warning', type: 'checkbox' });
    const go = el('button', { id: 'burn-warning-accept', type: 'button', disabled: true }, 'BUY');
    box.addEventListener('change', () => { go.disabled = !box.checked; });
    const cancel = () => { hideTicketDialog(); resolve(false); };
    go.addEventListener('click', () => { if (!box.checked) return; hideTicketDialog(); resolve(true); });
    const card = el('div', { class: 'tt', id: 'burn-warning-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'burn-title' },
      el('div', { class: 'tt-copy' },
        el('b', { class: 'tt-title', id: 'burn-title' }, 'THIS TICKET CAN BURN'),
        el('p', { id: 'burn-warning-en' }, `If you do not play by ${local} the ticket burns with no refund.`),
        el('p', { id: 'burn-warning-ru' }, `Если вы не начнёте поездку до ${local}, билет сгорает без возврата.`),
        el('p', { class: 'tt-detail', id: 'burn-warning-countdown', 'data-at': String(when.getTime()), 'data-iso': when.toISOString() }, `Last start ${when.toISOString()} · ${Math.ceil(left / 1000)}s`),
        el('label', { for: 'burn-warning' }, box, ' I understand the ticket is non-refundable and burns if I do not start by the last start.'),
        el('div', { class: 'td-actions' }, go, el('button', { type: 'button', class: 'td-close', onclick: cancel }, 'CANCEL'))));
    if (!n.hidden) hideTicketDialog();
    n.className = 'ok';
    n.replaceChildren(el('div', { class: 'td-back', onclick: cancel }), card);
    n.hidden = false;
    box.focus({ preventScroll: true });
  });
}

export function hideTicketDialog() {
  document.removeEventListener('keydown', onKey);
  const n = document.getElementById('ticket-dialog'); if (!n || n.hidden) return;
  n.hidden = true; n.replaceChildren();
  if (back?.isConnected) back.focus({ preventScroll: true }); back = null;
}

const host = () => {
  let n = document.getElementById('ticket-dialog'); if (n) return n;
  n = el('div', { id: 'ticket-dialog', hidden: true });
  document.body.append(n); return n;
};

/** ok: the bright ticket. Otherwise the sad one. `text` is the sentence; `shift` is the stub (1H / 4H / 8H), `qty` its count.
 *  rows = the receipt [{ k, v, href?, title? }] (href = a Solana explorer link); share = the x.com intent; more = an extra link { href, text }. */
export function ticketDialog({ ok, text, detail = '', shift = '', qty = 0, rows = [], share = null, more = null }) {
  const n = host();
  const close = el('button', { class: 'td-close', type: 'button', onclick: hideTicketDialog }, ok ? 'CLOSE' : 'OK');
  const card = el('div', { class: 'tt', role: ok ? 'dialog' : 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'tt-title', 'aria-describedby': 'tt-text' },
    el('div', { class: 'tt-stub', 'aria-hidden': 'true' }, bars(ok ? '#fff' : '#c9b4ac'), el('span', { class: 'tt-face' }, el('i'), el('i'), el('b')),
      shift ? el('span', { class: 'tt-shift' }, shift) : '', ok && qty > 1 ? el('span', { class: 'tt-qty' }, `×${qty}`) : ''),
    el('div', { class: 'tt-copy' },
      el('span', { class: 'tt-kicker' }, ok ? 'CONFIRMED · SOLANA DEVNET' : 'NOTHING MOVED'),
      el('b', { class: 'tt-title', id: 'tt-title' }, ok ? 'RIDE PAID' : 'THE BUY DIDN’T LAND'),
      el('p', { id: 'tt-text' }, text),
      detail ? el('p', { class: 'tt-detail' }, detail) : '',
      rows.length ? el('dl', { class: 'td-receipt' }, ...rows.flatMap(r => [el('dt', {}, r.k), el('dd', {}, r.href ? link(r.href, `${r.v} ↗`, r.title) : r.v)])) : '',
      more ? link(more.href, more.text) : '',
      el('div', { class: 'td-actions' },
        share ? el('a', { class: 'td-x', id: 'td-share-x', href: share, target: '_blank', rel: 'noopener noreferrer' }, 'POST ON ', el('span', { class: 'x-logo', 'aria-hidden': 'true' }, '𝕏')) : '',
        close)),
    el('button', { class: 'tt-x', type: 'button', 'aria-label': 'Close', onclick: hideTicketDialog }, '×'));
  if (ok) card.append(el('span', { class: 'tt-spark s1', 'aria-hidden': 'true' }), el('span', { class: 'tt-spark s2', 'aria-hidden': 'true' }), el('span', { class: 'tt-spark s3', 'aria-hidden': 'true' }));
  if (!n.hidden) hideTicketDialog();
  back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  n.className = ok ? 'ok' : 'sad';
  n.replaceChildren(el('div', { class: 'td-back', 'aria-hidden': 'true', onclick: hideTicketDialog }), card); n.hidden = false;
  document.addEventListener('keydown', onKey);
  (card.querySelector('.td-x') ?? close).focus({ preventScroll: true });
}
