import { el } from './dom.js';
import { t } from './i18n.js';

/* The Pre-season $500 table (GET /api/event/board): nothing before the review end, then the preliminary table, then the final list with each payout's Solscan link.
   Wallets arrive shortened; every string from the server goes in with textContent only (el never touches innerHTML). Strings: the lobby dictionary (site/i18n.js, event.*). */
const usd = cents => `$${(cents / 100).toFixed(2)}`;

export function eventBoardSection({ api, alive = () => true }) {
  const heading = el('h2', { id: 'event-board-title' });
  const box = el('div', { class: 'card', id: 'event-board' });
  const when = ms => (ms ? new Date(ms).toLocaleString() : t('event.notScheduled'));
  const paint = d => {
    if (!alive()) return;
    heading.textContent = d.phase === 'final' ? t('event.final') : t('event.title');
    if (d.phase === 'pending') { box.replaceChildren(el('p', { class: 'dim' }, t('event.pending'), when(d.reviewEnd))); return; }
    box.replaceChildren(
      el('p', { class: 'dim' }, d.phase === 'final' ? t('event.finalNote') : t('event.prelimNote') + when(d.appealsEnd)),
      el('table', { class: 'dense', id: 'event-board-table' },
        el('thead', {}, el('tr', {}, ...['#', t('event.wallet'), t('event.clean'), t('event.prize'), ''].map(h => el('th', {}, h)))),
        el('tbody', {}, d.rows.map(r => el('tr', { class: r.prizeEligible ? '' : 'dim' },
          el('td', {}, r.rank), el('td', { class: 'mono' }, r.wallet), el('td', {}, `${(r.bps / 100).toFixed(2)}%`),
          el('td', {}, r.prizeEligible ? usd(r.amountCents) : t('event.outside')),
          el('td', {}, r.solscanUrl ? el('a', { href: r.solscanUrl, target: '_blank', rel: 'noopener noreferrer' }, t('event.tx')) : ''))))));
  };
  api('event/board', undefined, { report: false }).then(paint).catch(() => { if (alive()) box.replaceChildren(); });
  return [heading, box];
}
