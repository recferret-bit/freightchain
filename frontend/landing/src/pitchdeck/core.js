/* What every part of the deck shares: the stage, its scale, the showing slide, one animation-frame loop, and a few small helpers. */

export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const view = { scale: 1, w: 1920, h: 1080, cur: -1 };   // scale: stage px → screen px (fit()); w: the stage's width (1920, wider on a screen wider than 16:9); cur: the showing slide
export const stage = document.getElementById('stage'), deck = document.getElementById('deck');

/** restart a one-shot CSS animation: drop the class, force a style flush, put it back */
export const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
/** a screen point → stage px (pass a stage rect read earlier in the same frame to avoid a second layout read) */
export const toStage = (x, y, s = stage.getBoundingClientRect()) => [(x - s.left) / view.scale, (y - s.top) / view.scale];
/** the index of the slide an element is on (read once, then compare with view.cur – no DOM walk per frame) */
export const slideOf = el => +(el?.closest('.slide')?.dataset.i ?? -1);

/* ONE requestAnimationFrame loop (the canvas scenes, the LIVE banner, the road). A system returns true to stay scheduled;
   the loop sleeps when every system returns false. On-demand loops (coins, a dragged card, the card lean, the ticker's ease) keep their own rAF and stop when they settle.
   A hidden tab gets no frames at all. */
const loops = [];
let scheduled = false;
function frame(t) {
  scheduled = false;
  let again = false;
  for (const f of loops) try { if (f(t)) again = true; } catch (e) { console.error(e); }   // one system failing never stops the others
  if (again) wakeFrames();
}
export function wakeFrames() { if (!scheduled) { scheduled = true; requestAnimationFrame(frame); } }
export const everyFrame = f => { loops.push(f); wakeFrames(); };

/** a one-shot stage element (author-made text only) that removes itself when its animation ends */
export const pop = (cls, html, x, y, ms = 2400) => {
  const el = document.createElement('div'); el.className = cls; el.innerHTML = html; el.style.left = `${x}px`; el.style.top = `${y}px`;
  el.addEventListener('animationend', e => { if (e.target === el) el.remove(); }); stage.append(el);
  if (reduced) setTimeout(() => el.remove(), ms);
  return el;
};
export const toast = (big, small) => pop('sol-toast', `<b>${big}</b><span>${small}</span>`, 760 + Math.random() * 820, 150 + Math.random() * 520);
/** a very small jolt: the `translate` property, so fit()'s transform is untouched */
export const shakeScreen = () => { if (!reduced) stage.animate({ translate: ['0 0', '-4px 2px', '3px -3px', '-2px 2px', '1px -1px', '0 0'] }, { duration: 320, easing: 'ease-out' }); };
