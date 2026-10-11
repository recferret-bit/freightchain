import { el } from './dom.js';

/* The paid-ticket result, over the lobby. Success is a Solana-coloured ticket (purple → green).
   A refusal is the same ticket, slumped and grey. The card under it keeps the sentence too. */
const NS = 'http://www.w3.org/2000/svg';
let timer = 0, hold = false, life = 0, started = 0;

const bars = fill => {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 44 28'); s.setAttribute('width', '40'); s.setAttribute('height', '26'); s.setAttribute('aria-hidden', 'true');
  const g = document.createElementNS(NS, 'g'); g.setAttribute('fill', fill);
  for (const y of [2, 11, 20]) { const p = document.createElementNS(NS, 'polygon'); p.setAttribute('points', `10,${y} 40,${y} 34,${y + 6} 4,${y + 6}`); g.append(p); }
  s.append(g); return s;
};

function arm(ms) {
  life = ms; started = Date.now(); clearTimeout(timer); timer = setTimeout(hideTicketToast, ms);
}
function onKey(e) { if (e.key === 'Escape') hideTicketToast(); }

export function hideTicketToast() {
  clearTimeout(timer); timer = 0; hold = false;
  document.removeEventListener('keydown', onKey);
  const n = document.getElementById('ticket-toast'); if (!n) return;
  n.hidden = true; n.replaceChildren();
}

const host = () => {
  let n = document.getElementById('ticket-toast'); if (n) return n;
  n = el('div', { id: 'ticket-toast', hidden: true });
  n.addEventListener('pointerenter', () => { if (!timer) return; hold = true; life -= Date.now() - started; clearTimeout(timer); timer = 0; });
  n.addEventListener('pointerleave', () => { if (!hold) return; hold = false; if (!n.hidden) arm(Math.max(life, 1600)); });
  document.body.append(n); return n;
};

/** ok: the bright ticket. Otherwise the sad one. `text` is the sentence; `shift` is the stub (1H / 4H / 8H). */
export function ticketToast({ ok, text, detail = '', href = null, link = '', shift = '' }) {
  const n = host();
  const card = el('div', { class: 'tt', role: ok ? 'dialog' : 'alertdialog', 'aria-modal': 'false', 'aria-labelledby': 'tt-title', 'aria-describedby': 'tt-text' },
    el('div', { class: 'tt-stub', 'aria-hidden': 'true' }, bars(ok ? '#fff' : '#c9b4ac'), el('span', { class: 'tt-face' }, el('i'), el('i'), el('b')), shift ? el('span', { class: 'tt-shift' }, shift) : ''),
    el('div', { class: 'tt-copy' },
      el('span', { class: 'tt-kicker' }, ok ? 'SOLANA DEVNET' : 'NOTHING MOVED'),
      el('b', { class: 'tt-title', id: 'tt-title' }, ok ? 'TICKET IN THE VAULT' : 'THE BUY DIDN’T LAND'),
      el('p', { id: 'tt-text' }, text),
      detail ? el('p', { class: 'tt-detail' }, detail) : '',
      href ? el('a', { href, target: '_blank', rel: 'noopener' }, link || 'Solana explorer ↗') : '',
      ok ? '' : el('button', { class: 'tt-ok', type: 'button', onclick: hideTicketToast }, 'OK')),
    el('button', { class: 'tt-x', type: 'button', 'aria-label': 'Dismiss', onclick: hideTicketToast }, '×'));
  if (ok) card.append(el('span', { class: 'tt-spark s1', 'aria-hidden': 'true' }), el('span', { class: 'tt-spark s2', 'aria-hidden': 'true' }), el('span', { class: 'tt-spark s3', 'aria-hidden': 'true' }));
  n.className = ok ? 'ok' : 'sad'; n.replaceChildren(card); n.hidden = false;
  n.style.animation = 'none'; void n.offsetWidth; n.style.animation = '';
  document.removeEventListener('keydown', onKey); document.addEventListener('keydown', onKey);
  arm(ok ? 8000 : 14000);
  if (!ok) card.querySelector('.tt-ok')?.focus();
}
