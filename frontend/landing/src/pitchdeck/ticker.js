/* the header ticker: the landing's running text (LCD green on black). One CSS animation moves the doubled strip at ~190 px/s (stage px);
   hover, and a click, ease its playback rate down to a crawl (~24 px/s) and back. The rate tween is its own short rAF, not the deck's frame loop.
   The loop duration is measured once (and on resize / when the fonts land), never per frame. */
import { FACTS } from './data.js';
import { reduced } from './core.js';

const FAST = 190, SLOW = 24, RATE = SLOW / FAST;
export const ticker = document.getElementById('ticker');
const tk = ticker.querySelector('.tk');
let over = false, holdTimer = 0, rate = 1, target = 1, easeRaf = 0, easeT = 0, have = 0;

const anim = () => tk.getAnimations?.().find(a => a.animationName === 'tkrun');
const applyRate = () => { const a = anim(); if (a) a.playbackRate = rate; };
function ease(t) {
  const dt = Math.min(.05, (t - easeT) / 1000 || .016); easeT = t;
  rate += (target - rate) * (1 - Math.exp(-dt * 3.5));   // ~0.3 s, same ease the old per-frame velocity used
  if (Math.abs(target - rate) < .004) rate = target;
  applyRate();
  easeRaf = rate === target ? 0 : requestAnimationFrame(ease);
}
const go = next => { target = next; if (!easeRaf) { easeT = performance.now(); easeRaf = requestAnimationFrame(ease); } };

export function initTicker() {
  const items = () => FACTS.map(f => { const e = document.createElement('span'), [kind, text] = Array.isArray(f) ? f : ['', f]; e.textContent = text; if (kind) e.className = kind; return e; });
  tk.append(...items(), ...items());   // doubled: translating -50% is one seamless loop
  if (reduced) return;
  const measure = () => {
    const w = tk.scrollWidth; if (w < 2) return;
    const dur = w / 2 / FAST;
    if (Math.abs(dur - have) < .05) return;
    have = dur; tk.style.animationDuration = `${dur}s`; applyRate();   // duration is the full loop at FAST; playbackRate slows it
  };
  measure(); document.fonts?.ready.then(measure); addEventListener('resize', measure);
  ticker.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { over = true; go(RATE); } });
  ticker.addEventListener('pointerleave', () => { over = false; if (!holdTimer) go(1); });
}
/** a click on the header slows it for a moment (instead of turning the page) */
export const holdTicker = () => {
  if (reduced) return;
  go(RATE); clearTimeout(holdTimer); holdTimer = setTimeout(() => { holdTimer = 0; if (!over) go(1); }, 1400);
};
