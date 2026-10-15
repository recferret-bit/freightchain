/* Core Web Vitals for the landing, the whitepaper, the pitch deck, and the lobby.
   One `web_vital` per metric per document, through client/js/analytics.js (no posthog-js).
   `value` is whole milliseconds, except CLS: the score × 1000 (0.1 → 100) because the relay drops floats.
   The rating is judged on the raw score, before that rounding.
   Nothing runs at import. play.html and viewer.html do not call this. */

import { track, flushSoon } from './analytics.js';

const SURFACES = new Set(['landing', 'whitepaper', 'lobby', 'pitchdeck']);
/* CrUX edges. A value on the edge is good (LCP 2500) or needs-improvement (LCP 4000). */
const EDGES = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] };
const NAV = new Set(['navigate', 'reload', 'back_forward', 'prerender']);

export function vitalRating(metric, raw) {
  const edge = EDGES[metric];
  if (!edge || typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw > edge[1]) return 'poor';
  if (raw > edge[0]) return 'needs-improvement';
  return 'good';
}

/* Layout-shift session windows: shifts under 1 s apart and inside 5 s of the first add up. Input shifts are ignored and do not extend the window. */
export function clsScore(shifts) {
  let session = 0, first = 0, last = 0, max = 0, open = false;
  for (const s of shifts) {
    if (s.input) continue;
    if (open && s.t - last < 1000 && s.t - first < 5000) session += s.v;
    else { session = s.v; first = s.t; open = true; }
    last = s.t;
    if (session > max) max = session;
  }
  return max;
}

/* Fewer than 50 interactions: the worst. At 50 and above: the second worst (the rough 98th percentile). */
export function inpScore(durations) {
  if (!durations.length) return null;
  const sorted = [...durations].sort((a, b) => b - a);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 50))];
}

function live() {
  if (typeof location === 'undefined' || location.protocol === 'file:') return false;
  return true;
}

function observe(type, cb, extra) {
  const PO = globalThis.PerformanceObserver;
  if (typeof PO !== 'function') return null;
  try {
    const po = new PO(list => { try { cb(list.getEntries()); } catch { /* one bad entry is not a metric */ } });
    po.observe({ type, buffered: true, ...extra });
    return po;
  } catch { return null; }   // the browser does not implement this entry type
}

function drain(po, cb) {
  if (!po) return;
  try { cb(po.takeRecords()); } catch { /* takeRecords is missing on an old observer */ }
  try { po.disconnect(); } catch { /* already disconnected */ }
}

let started = false;

export function reportWebVitals(surface) {
  if (started || !SURFACES.has(surface) || !live()) return;
  started = true;
  try { watch(surface); } catch { /* a vitals failure must not break the page; do not retry and double the listeners */ }
}

function watch(surface) {
  const sent = new Set();
  const navEntry = typeof performance !== 'undefined' && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
  const navigation = navEntry && NAV.has(navEntry.type) ? navEntry.type : null;

  function emit(metric, raw) {
    if (sent.has(metric) || raw == null || !Number.isFinite(raw) || raw < 0) return;
    const rating = vitalRating(metric, raw);
    if (!rating) return;
    sent.add(metric);
    const value = metric === 'CLS' ? Math.round(raw * 1000) : Math.round(raw);
    const properties = { surface, metric, value, rating };
    if (navigation) properties.navigation = navigation;
    track('web_vital', properties);
  }

  let lcp = null, lcpPo = null, clsPo = null, inpPo = null, closed = false;
  const shifts = [];
  const byId = new Map();

  function readLcp(entries) {
    const last = entries[entries.length - 1];
    if (last && typeof last.startTime === 'number') lcp = last.startTime;
  }
  function stopLcp() {
    if (sent.has('LCP')) return;
    drain(lcpPo, readLcp);
    lcpPo = null;
    if (lcp != null) emit('LCP', lcp);
  }
  function noteShift(e) {
    if (typeof e.startTime !== 'number' || typeof e.value !== 'number') return;
    shifts.push({ t: e.startTime, v: e.value, input: !!e.hadRecentInput });
  }
  function noteInp(e) {
    const id = e.interactionId;
    if (!id || !(e.duration >= 0)) return;
    const prev = byId.get(id) ?? 0;
    if (e.duration > prev) byId.set(id, e.duration);
  }
  const paint = entry => { if (entry.name === 'first-contentful-paint') emit('FCP', entry.startTime); };
  /* A fast navigation can hide the page before the observer callback runs. The timeline still has the paint. */
  function harvest() {
    try {
      for (const entry of performance.getEntriesByType('paint')) paint(entry);
      readLcp(performance.getEntriesByType('largest-contentful-paint'));
    } catch { /* the timeline is missing */ }
  }
  /* Registered before the first track(), so this runs before analytics flushes on leave and the last metrics leave with it. */
  function finalize() {
    if (closed) return;
    closed = true;
    harvest();
    stopLcp();
    if (clsPo) { drain(clsPo, entries => { for (const e of entries) noteShift(e); }); clsPo = null; emit('CLS', clsScore(shifts)); }
    if (inpPo) {
      drain(inpPo, entries => { for (const e of entries) noteInp(e); });
      inpPo = null;
      const score = inpScore([...byId.values()]);
      if (score != null) emit('INP', score);
    }
    flushSoon();
  }
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') finalize(); });
  addEventListener('pagehide', finalize);

  if (navEntry && navEntry.responseStart > 0) emit('TTFB', Math.max(navEntry.responseStart - (navEntry.activationStart || 0), 0));
  for (const entry of (typeof performance !== 'undefined' && performance.getEntriesByType ? performance.getEntriesByType('paint') : [])) paint(entry);
  observe('paint', entries => { for (const entry of entries) paint(entry); });

  lcpPo = observe('largest-contentful-paint', readLcp);
  if (lcpPo) for (const type of ['pointerdown', 'keydown', 'click']) addEventListener(type, stopLcp, { once: true, capture: true });
  clsPo = observe('layout-shift', entries => { for (const e of entries) noteShift(e); });
  /* 16 ms is the floor the browser will surface. Faster interactions are not the INP. */
  inpPo = observe('event', entries => { for (const e of entries) noteInp(e); }, { durationThreshold: 16 });
}
