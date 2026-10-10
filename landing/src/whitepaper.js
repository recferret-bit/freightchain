import { GAME_BASE, SITE_BASE, STORYBOOK_BASE } from '../../client/js/hosts.js';   // '' on localhost; on a real domain the game is on ride.<apex>, the lobby on the apex, the model viewer on storybook.<apex>
import { track, flushSoon } from '../../client/js/analytics.js';
import { reportWebVitals } from '../../client/js/web-vitals.js';   // web vitals and the page view both post through analytics.js to API_BASE (api.<apex> in production)

reportWebVitals('whitepaper');
track('whitepaper_viewed', { surface: 'whitepaper' });   // once per load, same idea as landing_viewed
document.getElementById('play-top')?.addEventListener('click', () => { track('offline_practice_clicked'); flushSoon(); });
document.getElementById('storybook-link')?.addEventListener('click', () => track('storybook_link_clicked'));

/* Links that leave this page: the HTML carries a same-origin fallback (works with no script), the bases make them point at the right host in production. */
const BASES = { site: SITE_BASE, game: GAME_BASE };
for (const a of document.querySelectorAll('a[data-to]')) {
  const to = a.dataset.to, path = a.dataset.path ?? '/';
  a.href = to === 'storybook' ? (STORYBOOK_BASE || path) : `${BASES[to] ?? ''}${path}`;
}

/* contents: highlight the chapter in view */
const toc = [...document.querySelectorAll('.toc a')];
const so = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) toc.forEach(a => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
}, { rootMargin: '-20% 0px -70% 0px' });
document.querySelectorAll('section[id]').forEach(s => so.observe(s));

/* chapter 02: the dash cards (data-live names a scene in wp-scenes.js). The game's cockpit code is loaded only when the chapter is near, and draws every card on one hidden canvas. */
const cards = [...document.querySelectorAll('.card3d[data-live]')], reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (cards.length) {
  const lio = new IntersectionObserver(es => {
    if (!es.some(e => e.isIntersecting)) return; lio.disconnect();
    Promise.all([import('./dash-live.js'), import('./wp-scenes.js')]).then(([m, s]) => m.startLiveDash(cards, s.WP_SCENES, { lazy: true })).catch(e => console.warn('live dash cards unavailable', e));
  }, { rootMargin: '600px' });
  lio.observe(document.getElementById('drive'));
}
/* the card tilts toward the pointer (same as the landing's dash) */
for (const card of cards) {
  if (reduced) continue;
  const MAX = 9;   // degrees at the card edge
  let r = null;   // measured once per hover: reading the rect on every pointermove forces a layout each time
  card.addEventListener('pointerenter', () => { r = card.getBoundingClientRect(); });
  card.addEventListener('pointermove', e => {
    r ??= card.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    card.classList.add('live');
    card.style.setProperty('--rx', `${((.5 - py) * MAX * 2).toFixed(2)}deg`); card.style.setProperty('--ry', `${((px - .5) * MAX * 2).toFixed(2)}deg`);
  });
  card.addEventListener('pointerleave', () => { r = null; card.classList.remove('live'); card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
}
