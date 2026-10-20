import { $, el, bindFlipCards, observeOnce } from '../../client/site/effects.js';
import { avatar, progressBarEl, extLink, splitBarEl } from '../../client/site/ui.js';
import { sol, km, left, short, hours, driven, ago, plural, TIER, TIER_LONG, ROUTE } from './format.js';
import { explorerUrl, shortAddr, progressText, phaseLine } from '../../client/site/pools.js';

/* Reusable data-driven sections and interactive card components for the landing page.
   All server data is rendered via textContent / el() – never innerHTML. */

const empty = txt => [el('span', { class: 'dim' }, txt)];

/** Smooth cubic-out odometer counter tween. */
export function count(elm, target, fmt, reduced = false) {
  const from = +elm.dataset.v || 0; elm.dataset.v = target;
  if (reduced || from === target) { elm.textContent = fmt(target); return; }
  const t0 = performance.now(), T = 900;
  const step = t => {
    const k = Math.min(1, (t - t0) / T), e = 1 - (1 - k) ** 3;
    elm.textContent = fmt(from + (target - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** `{ pool: null }` (GET /api/pools/current) and a body with no split and no escrow keep the static hero. */
function heroPool(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.pool === null && raw.split == null && !raw.pools?.length) return null;
  return raw;
}

const POOL_FALLBACK = 'Free rides and practice are open. No prize has been paid.';

/** Hero stats tiles + chapter 04/05 live cells. */
export function paintHero(S, now, reduced) {
  const p = heroPool(S.pool), l = S.live;
  if (p) {
    const esc = p.pools?.length ? p.pools.reduce((a, x) => a + x.vaultLamports, 0) : null;
    if (esc != null) {
      $('hero-pot-lbl').textContent = `IN ESCROW · ${plural(p.pools.length, 'POOL', 'POOLS')}`;
      count($('hero-pot'), esc, v => sol(v), reduced);
      $('hero-usd').textContent = p.solUsd ? `≈ $${((esc / 1e9) * p.solUsd).toFixed(2)}` : '';
      if ($('hero-pot-note')) $('hero-pot-note').hidden = true;
    } else {
      $('hero-pot-lbl').textContent = 'ACCRUED THIS WEEK · NOT PAID';
      const grand = Number(p.split?.grand) || 0;
      if (grand > 0) count($('hero-pot'), grand, v => sol(v), reduced);
      else $('hero-pot').textContent = '–';
      $('hero-usd').textContent = grand > 0 && p.usd?.grand != null ? `≈ $${p.usd.grand}` : '';
      if ($('hero-pot-note')) {
        $('hero-pot-note').hidden = false;
        $('hero-pot-note').textContent = POOL_FALLBACK;
      }
    }
    $('hero-cd').textContent = p.round?.endsAt != null ? left(p.round.endsAt - now()) : '–';
    const hasEsc = p.pools?.length;
    $('lb-entries').textContent = hasEsc ? `${p.entries} this round` : 'devnet soon';
    $('lb-pot').textContent = hasEsc ? `${sol(p.pools.reduce((a, x) => a + x.vaultLamports, 0))} SOL` : '–';
    $('lb-tickets-st').textContent = hasEsc ? 'ROLLING · DEVNET' : 'SOON'; $('lb-tickets-st').className = hasEsc ? 'rolling' : 'bid';
    $('lb-pools-st').textContent = hasEsc ? 'ACCRUING' : 'SOON'; $('lb-pools-st').className = hasEsc ? 'rolling' : 'bid';
  }
  if (l) {
    count($('hero-live'), l.rides.length, v => String(Math.round(v)), reduced);
    count($('hero-km'), l.totals.metres, v => km(v), reduced);
    $('hero-shifts').textContent = plural(l.totals.rides, 'ride');
    $('hero-time').textContent = driven(l.totals.seconds);
    $('chip-live').textContent = `${l.online ? `${l.online.total} ONLINE · ` : ''}${l.rides.length} ON THE ROAD`;
    $('soc-live').textContent = l.rides.length;
    $('lb-drivers').textContent = plural(l.totals.drivers, 'driver');
    $('lb-live').textContent = `${l.rides.length} on the road now`;
    $('sheet-km').textContent = km(l.totals.metres);
  }
}

/** Chapter 03 weekly pool split card (#poolbox). Returns .cd countdown nodes inside the card. */
export function paintPool(S, now) {
  const box = $('poolbox'), p = heroPool(S.pool);
  if (!p?.split || !p.usd) { box.replaceChildren(el('span', { class: 'dim' }, 'Prize pool unavailable right now.')); return []; }
  const s = p.split, parts = [s.grand, s.top20, s.nextSeed, s.fees], total = parts.reduce((x, y) => x + y, 0), pct = total ? parts.map(x => (x / total) * 100) : [50, 20, 20, 10];
  const splitRows = splitBarEl([['s-grand', '50% grand prize · accrued', s.grand], ['s-top', '20% top 20 · by distance', s.top20], ['s-seed', '20% seeds next week', s.nextSeed], ['s-fees', '10% platform', s.fees]].map(([cls, txt, l], i) => ({ cls, pct: pct[i], label: [`${txt} `, el('b', {}, `${sol(l)} SOL`)] })));
  const noteEl = el('div', { class: 'dim' }, 'Integer lamports, floored shares, remainder to fees. This round is accounted. It is not paid out.');
  const esc = p.pools?.length ? p.pools.reduce((a, x) => a + x.vaultLamports, 0) : null;
  if (esc == null) {
    box.replaceChildren(
      el('span', { class: 'lbl' }, 'WEEKLY ROUND · ACCRUED, NOT PAID'),
      el('div', { class: 'big' }, `${sol(s.grand)} SOL`),
      el('div', { class: 'usd' }, p.usd.grand != null ? `≈ $${p.usd.grand}` : 'No prize has been paid out'),
      ...splitRows,
      el('div', { class: 'meta' }, el('span', {}, el('b', {}, 'Free rides and practice are open'), ' · paid shifts are marked soon')),
      noteEl);
  } else {
    box.replaceChildren(
      el('span', { class: 'lbl' }, 'GRAND PRIZE · ACCRUED THIS WEEK'),
      el('div', { class: 'big' }, `${sol(s.grand)} SOL`),
      el('div', { class: 'usd' }, p.usd.grand != null ? `≈ $${p.usd.grand} at the current price${p.solUsd ? ` · SOL $${p.solUsd}` : ''}` : ''),
      ...splitRows,
      el('div', { class: 'meta' }, el('span', {}, el('b', {}, p.entries), ` paid ${p.entries === 1 ? 'entry' : 'entries'}`), el('span', {}, 'closes in ', el('b', { class: 'cd' }, left(p.round.endsAt - now()))), el('span', {}, s.carry ? ['carried from last week: ', el('b', {}, `${sol(s.carry)} SOL`)] : 'first round – nothing carried yet')),
      noteEl);
  }
  return [...box.querySelectorAll('.cd')];
}

/** Chapter 03 SHIFTS table (#tiers + #price). */
export function paintTiers(t) {
  const program = t.paymentMode === 'program';
  const price = x => x.pool ? `${sol(x.pool.priceLamports)} SOL` : x.lamports ? `${sol(x.lamports)} SOL` : '–';
  const paidWith = x => x.pool ? 'pool ticket' : !x.usd ? 'free' : x.onSale === false ? 'soon' : program ? 'pool ticket · none on sale' : `$${x.usd}`;
  const rows = t.tiers.map(x => el('tr', {}, el('td', {}, TIER_LONG[x.id] ?? x.id), el('td', {}, hours(x.seconds)), el('td', {}, paidWith(x)), el('td', {}, price(x))));
  $('tiers').replaceChildren(el('thead', {}, el('tr', {}, ...['SHIFT', 'LENGTH', 'PAID WITH', 'IN SOL'].map(h => el('th', {}, h)))), el('tbody', {}, rows));
  const pooled = t.tiers.some(x => x.pool), legacy = !program && t.tiers.some(x => x.usd && !x.pool && x.onSale !== false);
  const soonNames = t.tiers.flatMap(x => x.onSale === false && !x.pool && x.usd ? [x.id === '1h' ? '1 hour' : x.id === '4h' ? '4 hour' : '8 hour'] : []);
  const soonText = !soonNames.length ? '' : `The ${soonNames.length === 1 ? soonNames[0] : `${soonNames.slice(0, -1).join(', ')} and ${soonNames.at(-1)}`} shift${soonNames.length === 1 ? ' is' : 's are'} planned and not on sale yet.`;
  $('price').textContent = [pooled && 'Pool tickets: the price is part of the pool’s rules, fixed when it was created.', legacy && (t.solUsd ? `Pay-per-ride: SOL ≈ $${t.solUsd}, the quote is locked for 10 minutes when you order.` : 'Pay-per-ride: SOL price unavailable right now.'), soonText, 'Devnet SOL only.'].filter(Boolean).join(' ');
}

/** Chapter 03 PRIZE POOLS list (#pools). */
export function paintPools(S, now) {
  const box = $('pools'), list = S.pool?.pools;
  if (!list) { box.replaceChildren(...empty('Pools unavailable right now.')); return; }
  if (!list.length) { box.replaceChildren(...empty('No pool on sale right now – the next one opens with the week.')); return; }
  const n = now();
  box.replaceChildren(...list.map(p => {
    const f = phaseLine(p, n);
    return el('div', { class: 'r prow' },
      el('span', { class: 'w' }, el('b', {}, TIER[p.tier] ?? p.tier), el('span', { class: `pst ${f.cls}` }, f.text), el('small', {}, p.label)),
      el('span', { class: 'v' }, `${sol(p.vaultLamports)} SOL in escrow`),
      progressBarEl(p.progressPct, 'span'),
      el('span', { class: 'pmeta' }, progressText(p, n), ` · ${sol(p.priceLamports)} SOL a ticket · `,
        extLink(explorerUrl(p.address), { title: p.address }, `pool ${shortAddr(p.address)} ↗`)));
  }));
}

/** Chapter 03 WINNERS standings block (#winners). */
export function paintWinners(box, st, siteBase) {
  box.hidden = !st;
  if (!st) return;
  box.replaceChildren(
    el('h3', {}, `WINNERS · ${st.label}`, el('span', { class: `pst ${st.final ? 'live' : 'open'}` }, st.final ? 'FINAL' : 'PROVISIONAL')),
    ...(st.ranks.length ? st.ranks.slice(0, 5).map(r => el('div', { class: 'r' },
      el('span', { class: 'n' }, `#${r.rank}`),
      el('span', { class: 'w' }, avatar(r.wallet, true), short(r.wallet), el('small', {}, `${km(r.distance)} km`)),
      el('span', { class: 'v' }, `${sol(r.lamports)} SOL${r.paid ? ' ✓' : ''}`))) : empty('No verified finisher.')),
    el('a', { class: 'link', href: `${siteBase}/lobby.html#new` }, 'all ranks →'));
}

/** Chapter 03 three boards (#board-next, #board-recent, #board-top). */
export function paintBoards(S, now, watchUrl) {
  const l = S.live;
  if (l) {
    $('board-next').replaceChildren(...(l.upcoming.length ? l.upcoming.slice(0, 8).map(r => el('div', { class: 'r' },
      el('span', { class: 'w' }, avatar(r.wallet, true), short(r.wallet), el('small', {}, TIER[r.tier] ?? r.tier)),
      el('span', {}, ''),
      el('span', { class: 'v' }, `paid ${ago(now() - r.paidAt)}`))) : empty('No paid shift waiting to start. A paid order sits here until its driver turns the key.')));
  }
  if (S.replays) {
    $('board-recent').replaceChildren(...(S.replays.length ? S.replays.map(r => el(r.replay ? 'a' : 'div', { class: 'r r2', ...(r.replay ? { href: watchUrl(r.id), title: `replay ${short(r.wallet)}'s ride` } : {}) },
      el('span', { class: 'w' }, avatar(r.wallet, true), el('span', { class: 'wt' }, short(r.wallet), el('small', {}, TIER[r.tier] ?? r.tier, r.route ? ` · ${ROUTE[r.route] ?? r.route}` : ''))),
      el('span', { class: 'v' }, r.status === 'completed' ? `${km(r.distance)} km ✓` : r.status === 'failed' ? (r.failCode === 'heartbeat_lost' ? 'signal lost' : 'failed') : 'abandoned'))) : empty('No finished rides yet – the first one shows up here, ready to replay.')));
  }
  if (S.board) {
    const rows = S.board.rows.slice(0, 10);
    $('board-top').replaceChildren(...(rows.length ? rows.map(r => el('div', { class: `r${S.me && r.wallet === S.me.wallet ? ' me' : ''}` },
      el('span', { class: 'n' }, `#${r.rank}`),
      el('span', { class: 'w' }, avatar(r.wallet, true), short(r.wallet), el('small', {}, plural(r.rides, 'ride'))),
      el('span', { class: 'v' }, `${km(r.distance)} km`))) : empty('No finished paid shift this round yet. The first finisher is #1.')));
  }
}

/** Builds the ticker items + DOM nodes for #ticker. */
export function buildTickerNodes(S, watchUrl) {
  const l = S.live, p = S.pool, items = [];
  if (l) for (const r of l.rides.filter(r => r.tier !== 'free').slice(0, 4)) items.push([`● LIVE · ${short(r.wallet)} on ${r.route ? ROUTE[r.route] ?? r.route : 'the road'} · ${km(r.distance)} km · ▶ watch`, watchUrl(r.id)]);
  if (l) for (const r of l.recent.slice(0, 8)) items.push([`${short(r.wallet)} ${r.status === 'completed' ? 'finished' : r.status === 'failed' ? 'wrecked' : 'abandoned'} a ${TIER_LONG[r.tier]?.toLowerCase() ?? r.tier} shift${r.route ? ` on ${ROUTE[r.route] ?? r.route}` : ''} · ${km(r.distance)} km · ▶ replay`, watchUrl(r.id)]);
  if (p?.pools?.length) items.push(`${sol(p.pools.reduce((a, x) => a + x.vaultLamports, 0))} SOL in escrow across ${plural(p.pools.length, 'prize pool')} · ${plural(p.pools.reduce((a, x) => a + x.toGo, 0), 'more rider')} to go live`);
  else if (p) items.push('Free rides & practice mode active · devnet prize pool opening soon');
  if (l) {
    items.push(`${plural(l.rides.length, 'truck')} on the road right now`, `${km(l.totals.metres)} km driven by ${plural(l.totals.drivers, 'driver')} all time`);
    if (l.upcoming.length) items.push(`${plural(l.upcoming.length, 'paid shift')} waiting to start`);
  }
  if (!items.length) items.push('Dispatch is quiet. Connect a wallet, take a free ride, be the first line on this ticker.');
  const key = items.map(t => (Array.isArray(t) ? `${t[1]}\t${t[0]}` : t)).join('\n');
  const nodes = items.map(t => (Array.isArray(t) ? el('a', { href: t[1], tabindex: '-1' }, t[0]) : el('span', {}, t)));
  return { key, nodes };
}

/** UNDER THE HOOD (.oc) flip-cards + bfcache reset + lazy canvas scenes. */
export function bindChainCards(reduced, onSeen) {
  const flipped = new Set(), seen = card => { if (!flipped.has(card)) { flipped.add(card); onSeen(card); } };
  bindFlipCards(document.querySelectorAll('.oc'), { onOpen: c => seen(c.dataset.card), hoverDwellMs: 600 });
  addEventListener('pageshow', e => {
    if (!e.persisted) return;
    for (const c of document.querySelectorAll('.oc.flip')) c.classList.remove('flip');
    if (document.activeElement?.closest('.oc')) document.activeElement.blur();
  });
  const ocGrid = document.querySelector('.oc-grid');
  if (ocGrid && !reduced) {
    observeOnce(ocGrid, () => {
      import('./chain-scenes.js').then(m => m.startChainScenes(ocGrid.querySelectorAll('.oc'))).catch(e => console.warn('chain scenes unavailable', e));
    }, '120px');
  }
}

