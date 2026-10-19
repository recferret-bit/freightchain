import '../../client/js/crash-boot.js';   // before the rest of this page: a throw while it loads is still reported
import { GAME_BASE, SITE_BASE, STORYBOOK_BASE } from '../../client/js/hosts.js';   // '' on localhost; on a real domain the game is on ride.<apex>, the lobby on the apex, the model viewer on storybook.<apex>
import { track, flushSoon } from '../../client/js/analytics.js';
import { reportWebVitals } from '../../client/js/web-vitals.js';   // web vitals and the page view both post through analytics.js to API_BASE (api.<apex> in production)
import { $, bindCard3d, bindScrollSpy, observeOnce, guardMobilePlay } from '../../client/site/effects.js';
import { bindAnchors } from './anchor.js';

bindAnchors();   // before the contents observer, so a #onchain load is already on the chapter it highlights
reportWebVitals('whitepaper');
track('whitepaper_viewed', { surface: 'whitepaper' });   // once per load, same idea as landing_viewed

document.getElementById('play-top')?.addEventListener('click', e =>
  guardMobilePlay(e, { siteBase: SITE_BASE }, () => { track('offline_practice_clicked'); flushSoon(); }));
document.getElementById('storybook-link')?.addEventListener('click', () => track('storybook_link_clicked'));

/* Links that leave this page: the HTML names the production URL (what a crawler reads – this host would only serve the wrong page or a redirect there), the bases point them at the right host – one origin locally. */
const BASES = { site: SITE_BASE, game: GAME_BASE };
for (const a of document.querySelectorAll('a[data-to]')) {
  const to = a.dataset.to, path = a.dataset.path ?? '/';
  a.href = to === 'storybook' ? (STORYBOOK_BASE || path) : `${BASES[to] ?? ''}${path}`;
  if (to === 'game' && a.id !== 'play-top' && !path.includes('watch=')) {
    a.addEventListener('click', e =>
      guardMobilePlay(e, { siteBase: SITE_BASE }, () => { if (!path.includes('ride=')) { track('offline_practice_clicked'); flushSoon(); } }));
  }
}

/* contents: highlight the chapter in view */
bindScrollSpy(document.querySelectorAll('.toc a'), { rootMargin: '-20% 0px -70% 0px' });

/* chapter 02: the dash cards (data-live names a scene in wp-scenes.js). The game's cockpit code is loaded only when the chapter is near, and draws every card on one hidden canvas. */
const cards = [...document.querySelectorAll('.card3d[data-live]')], reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (cards.length) {
  observeOnce($('drive'), () => {
    Promise.all([import('./dash-live.js'), import('./wp-scenes.js')]).then(([m, s]) => m.startLiveDash(cards, s.WP_SCENES, { lazy: true })).catch(e => console.warn('live dash cards unavailable', e));
  }, '600px');
}
bindCard3d(cards, 9, reduced);
