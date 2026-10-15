/* the header ticker: the landing's running text (LCD green on black), driven by script – ~190 px/s (stage px), easing down to a crawl while the pointer is over it
   and for a moment after a click / tap, then back up. Its loop width is measured once (and on resize / when the fonts land), never per frame. */
import { FACTS } from './data.js';
import { reduced, everyFrame } from './core.js';

const FAST = 190, SLOW = 24;
export const ticker = document.getElementById('ticker');
const tk = ticker.querySelector('.tk');
let x = 0, v = FAST, hold = 0, over = false, last = 0, half = 1;

export function initTicker() {
  const items = () => FACTS.map(f => { const e = document.createElement('span'), [kind, text] = Array.isArray(f) ? f : ['', f]; e.textContent = text; if (kind) e.className = kind; return e; });
  tk.append(...items(), ...items());   // doubled: half its width is one seamless loop
  const measure = () => { half = tk.scrollWidth / 2 || 1; };
  measure(); document.fonts?.ready.then(measure); addEventListener('resize', measure);
  ticker.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') over = true; });
  ticker.addEventListener('pointerleave', () => { over = false; });
  everyFrame(t => {
    const dt = Math.min(.1, (t - last) / 1000) || 0; last = t;
    const target = reduced ? 0 : (over || t < hold) ? SLOW : FAST;
    v += (target - v) * (1 - Math.exp(-dt * 3.5));   // an exponential tween: ~0.3 s to most of the way either direction
    if (!v) return;
    x = (x + v * dt) % half;
    tk.style.transform = `translateX(${-x.toFixed(1)}px)`;
  });
}
/** a click on the header slows it for a moment (instead of turning the page) */
export const holdTicker = () => { hold = performance.now() + 1400; };
