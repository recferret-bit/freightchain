import { THEMES } from '../themes/index.js';
import { env } from '../world/environment.js';
import { selectTheme } from '../world/theme-manager.js';
import { dn } from '../state.js';
import { setPhase } from '../world/daynight.js';
import { online } from '../online.js';
import { track } from '../analytics.js';

/* Route picker shown in the menu. Clicking a card applies the route to the 3D scene behind the menu (live preview) and remembers it. */
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const info = t => `<b>${t.name}</b> — ${t.route}<br>${t.blurb}<br><span class="dim">Curves</span> ${stars(t.difficulty)}`;
export function routesHTML() {
  const cards = THEMES.map(t => `<div class="route${t.id === env.theme.id ? ' sel' : ''}" data-id="${t.id}"><div class="sw" style="background:linear-gradient(${t.swatches[0]} 0 38%,${t.swatches[1]} 38% 72%,${t.swatches[2]} 72%)"></div><b>${t.name}</b><span>${t.country}</span></div>`).join('');
  return `<div class="routes">${cards}</div><div id="routeinfo">${info(env.theme)}</div>`;
}
export function bindRoutes(root) {
  const cards = root.querySelectorAll('.route');
  cards.forEach(el => { el.onclick = () => { const t = selectTheme(el.dataset.id); cards.forEach(e => e.classList.toggle('sel', e === el)); root.querySelector('#routeinfo').innerHTML = info(t); if (online.ride) track('route_selected', { route_id: t.id }); }; });
}

/* Time-of-day cards in the menu (day / dusk / night / dawn – jump the clock to that phase of the CURRENT route, which then keeps running at the F2 time scale). Follows dn.phase (dn.onChange). */
const PH = [['day', '☀ DAY'], ['dusk', '◗ DUSK'], ['night', '☾ NIGHT'], ['dawn', '◖ DAWN']];
export const timeHTML = () => `<div class="tod">${PH.map(([p, l]) => `<div class="tcard${dn.phase === p ? ' sel' : ''}" data-p="${p}">${l}</div>`).join('')}</div>`;
export function bindTime(root) {
  const cards = root.querySelectorAll('.tcard'), sync = () => cards.forEach(e => e.classList.toggle('sel', e.dataset.p === dn.phase));
  cards.forEach(el => { el.onclick = () => { setPhase(el.dataset.p); sync(); if (online.ride) track('phase_selected', { phase: el.dataset.p }); }; }); dn.onChange = sync;
}
