import { el } from './dom.js';
export { bindCard3d, bindFlipCards, bindScrollSpy, observeOnce, guardMobilePlay } from './effects.js';

/* Shared UI components and formatters used across Landing and Lobby.
   Pure functions + safe DOM builders (el() only, never innerHTML). */

export const ROUTE = {
  route66: 'Route 66',
  stuart: 'Stuart Hwy',
  siberia: 'Trans-Siberian',
  brenner: 'Brenner',
  panamerican: 'Pan-American',
};

export const TIER = { free: 'TEST', '1h': '1 H', '4h': '4 H', '8h': '8 H' };
export const TIER_LONG = { free: 'Test ride', '1h': '1 hour', '4h': '4 hours', '8h': '8 hours' };
export const TIER_NAME = { ...TIER_LONG, free: 'Free ride' };

export const pad = n => String(Math.floor(n)).padStart(2, '0');

/** Deterministic 0–359 hue from a wallet address. */
export const hue = (w = '') => {
  let h = 0;
  for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

/** Seconds → 'm:ss' under an hour, 'h:mm:ss' over, clamps and rounds. */
export const dur = s => {
  s = Math.max(0, Math.round(s));
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`
    : `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

/** Metres → '12.3' km string with 1 decimal place. */
export const km1 = (m = 0) => (Math.max(0, m || 0) / 1000).toFixed(1);

/** Elapsed ms → coarse relative time ('just now', '2 min ago' / '2m ago'). */
export const ago = (ms, compact = false) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}${compact ? 'm' : ' min'} ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}${compact ? 'h' : ' h'} ago`;
  return `${Math.floor(s / 86400)}${compact ? 'd' : ' d'} ago`;
};

/** Wallet avatar badge (<span class="av" style="--h:...">xx</span> or <i class="av"> dot). */
export const avatar = (w = '', dot = false) =>
  dot ? el('i', { class: 'av', style: `background:hsl(${hue(w)} 60% 50%)` })
    : el('span', { class: 'av', style: `--h:${hue(w)}` }, (w || '??').slice(0, 2));

/** Driver name element (<b class="w" data-wallet="...">...</b>) wired to SNS lookup. */
export function driverEl(wallet, sns, shortFn, bindFn, cls = 'w') {
  const node = el('b', { class: cls, 'data-wallet': wallet || '' }, shortFn(wallet, sns));
  if (bindFn && wallet) bindFn(node, wallet, sns);
  return node;
}

/** Horizontal fill bar (<div class="bar"><i style="width:...%"></i></div>). */
export const progressBarEl = (pct = 0, tag = 'div', cls = 'bar') =>
  el(tag, { class: cls }, el('i', { style: `width:${Math.max(0, Math.min(100, Math.round(pct)))}%` }));

/** Segmented pill button bar (<div class="seg" role="group">...</div>). */
export function pillGroupEl(items, activeId, onPick, attrs = {}) {
  return el('div', { class: 'seg', role: 'group', ...attrs },
    items.map(([id, label]) => el('button', {
      type: 'button',
      class: activeId === id ? 'on' : '',
      'aria-pressed': activeId === id ? 'true' : 'false',
      onclick: () => onPick(id),
    }, label)));
}

/** External anchor (<a target="_blank" rel="noopener">...</a>). */
export const extLink = (href, attrs = {}, ...kids) =>
  el('a', { href, target: '_blank', rel: 'noopener', ...attrs }, ...kids);

/** Proportional split bar + legend (<div class="split"> + <div class="legend">). */
export const splitBarEl = parts => [
  el('div', { class: 'split' }, ...parts.map(s => el('i', { class: s.cls, style: `width:${s.pct}%` }))),
  el('div', { class: 'legend' }, ...parts.map(s => el('span', { class: s.cls }, ...s.label))),
];

