import { GAME_BASE, SITE_BASE, STORYBOOK_BASE } from '../../client/js/hosts.js';   // '' on localhost; on a real domain the game is on ride.<apex>, the lobby on the apex, the model viewer on storybook.<apex>

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
