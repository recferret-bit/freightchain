/* The deck's analytics (docs/agents/analytics.md): page views and attraction through client/js/analytics.js → POST /api/telemetry on api.<apex>, never posthog-js.
   Anonymous: the deck sends WITHOUT credentials (configure), so a page view never carries a player session. Events: pitchdeck_viewed (one per load: where the visitor came from),
   pitchdeck_slide_viewed (the first view of each slide per load, and how they got there), pitchdeck_slide_time (visible ms on a slide, sent when it changes or the page is left),
   pitchdeck_interaction (the first use of each toy per load). The 70/20/10 bar is not in WHAT: hover opens it, so pitchdeck.js calls interact('split') from expand(). Nothing here is read back by the page. */
import { track, flushSoon, configure } from '../../../client/js/analytics.js';
import { reportWebVitals } from '../../../client/js/web-vitals.js';
import { SITE_BASE, WHITEPAPER_BASE } from '../../../client/js/hosts.js';

const TAG = /^[a-z0-9_-]{1,40}$/i;   // a share link's own ?src= tag (email, x, investor-name…); anything else is dropped
const WHAT = [   // what a click / tap on the stage counts as (first match wins)
  ['.pts li.don', 'donate'], ['.pts li.adopt', 'adopt'], ['.ladder li', 'tier'], ['.lanes-ctl button', 'lane'], ['.truck', 'honk'], ['.exit', 'exit_sign'], ['.plan .bar', 'plan_bar'],
  ['.fx .shot, .fx .badge, .fx canvas.glyph, .L-wall .tags span, .cards5 .cc', 'card'], ['#fs', 'fullscreen'],
];
let ids = [], cur = -1, since = 0;
const seenSlide = new Set(), seenWhat = new Set();

const hostOf = u => { try { return new URL(u).host; } catch { return ''; } };
/* landing / whitepaper / homescreen (the manifest's start_url carries ?src=homescreen, or the page runs standalone) / direct (no referrer) / other */
function sourceOf(src, standalone) {
  if (src === 'homescreen' || standalone) return 'homescreen';
  const ref = hostOf(document.referrer);
  if (!ref) return 'direct';
  if (ref === location.host) return 'other';   // the deck itself (a reload from a link inside it)
  if (ref === (SITE_BASE ? hostOf(SITE_BASE) : location.host) || ref === `www.${hostOf(SITE_BASE)}`) return 'landing';
  if (WHITEPAPER_BASE && ref === hostOf(WHITEPAPER_BASE)) return 'whitepaper';
  return 'other';
}

function leave() {   // the visible time spent on the slide that is going away
  if (cur < 0 || !since) return;
  const ms = Math.round(performance.now() - since); since = 0;
  if (ms >= 1500) track('pitchdeck_slide_time', { slide: ids[cur], index: cur + 1, ms: Math.min(ms, 600000) });
}

/** a slide came into view (via: load / key / button / swipe / hash) */
export function slideShown(i, via) {
  leave(); cur = i; since = document.hidden ? 0 : performance.now();
  if (!seenSlide.has(i)) { seenSlide.add(i); track('pitchdeck_slide_viewed', { slide: ids[i], index: i + 1, via }); }
}

/** the first use of a toy per load */
export function interact(what) {
  if (seenWhat.has(what)) return;
  seenWhat.add(what); track('pitchdeck_interaction', { slide: ids[cur] ?? null, what });
}

export function initStats(slideIds, touch) {
  ids = slideIds;
  configure({ credentials: 'omit' });
  reportWebVitals('pitchdeck');   // before the first track(), so the leave flush includes the final metrics
  const q = new URLSearchParams(location.search).get('src'), src = q && TAG.test(q) ? q.toLowerCase() : null;
  const standalone = !!(navigator.standalone || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
  track('pitchdeck_viewed', { surface: 'pitchdeck', from: sourceOf(src, standalone), src, touch, standalone });   // `source` is the relay's client/server plane; `from` is where this open came from
  addEventListener('click', e => { const t = e.target; if (!t.closest) return; for (const [sel, what] of WHAT) if (t.closest(sel)) { interact(what); return; } }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { leave(); flushSoon(); } else if (cur >= 0) since = performance.now(); });
  addEventListener('pagehide', () => { leave(); flushSoon(); });
}
