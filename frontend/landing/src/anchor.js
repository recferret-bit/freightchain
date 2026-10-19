/* Header shortcuts and every other in-page # link.
   Native smooth scrolling stops short of the heading: chapters with content-visibility
   still occupy their estimated height while the animation runs, and scroll-padding is a
   fixed guess at the sticky bar, so the title lands under the bar or a chapter early.
   Lay the chapters out, then put the heading just under the bar that is actually there. */

const GAP = 16;   // air between the sticky bar and the heading

const docTop = node => {
  let y = 0;
  for (let n = node; n; n = n.offsetParent) y += n.offsetTop;   // layout position: a .rv translateY must not shift the target
  return y;
};

export function bindAnchors() {
  document.documentElement.style.scrollBehavior = 'auto';   // the stylesheet value is what misses; this owns the motion
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const scroller = document.scrollingElement;
  const bar = () => document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0;
  const mark = el => el.querySelector(':scope > .ch-h') || el;
  const dest = el => Math.max(0, docTop(mark(el)) - bar() - GAP);
  const reveal = () => { document.querySelectorAll('.ch').forEach(s => { s.style.contentVisibility = 'visible'; }); };
  const show = el => {
    const m = mark(el);
    if (!m.classList.contains('rv') || m.classList.contains('in')) return;
    m.style.transition = 'none'; m.classList.add('in'); void m.offsetWidth; m.style.transition = '';   // visible at the landing spot, not fading up into it
  };

  /* The browser scrolls a # target to scroll-padding on its own (a load, Back) and will
     overwrite us. Shift that target by the heading's padding so its landing spot is ours. */
  const alignNative = el => {
    const head = mark(el);
    const inside = docTop(head) - docTop(el);
    const scrollPad = parseFloat(window.getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    el.style.scrollMarginTop = `${Math.round(bar() + GAP - inside - scrollPad)}px`;
  };
  const place = el => { alignNative(el); scroller.scrollTop = dest(el); };

  let run = 0;
  const go = (el, animate) => {
    reveal(); show(el); alignNative(el);
    const id = ++run;
    const start = window.scrollY, target = dest(el);
    if (!animate || reduced.matches || Math.abs(target - start) < 2) { place(el); return; }
    const dur = Math.min(640, 200 + Math.abs(target - start) * 0.12);
    let t0 = 0;
    const step = now => {
      if (id !== run) return;
      t0 ||= now;
      const p = Math.min(1, (now - t0) / dur), e = 1 - (1 - p) ** 3;
      scroller.scrollTop = Math.round(start + (dest(el) - start) * e);
      if (p < 1) requestAnimationFrame(step);
      else place(el);
    };
    requestAnimationFrame(step);
    setTimeout(() => { if (id === run) place(el); }, dur + 90);   // a stalled frame must not leave the heading short of the bar
  };

  const cancel = () => { run++; };
  addEventListener('wheel', cancel, { passive: true });
  addEventListener('touchmove', cancel, { passive: true });
  addEventListener('pointerdown', cancel);   // a drag on the scrollbar gives up the animation, including its final snap

  const fromHash = () => {
    const id = decodeURIComponent(location.hash.replace(/^#/, ''));
    const el = id && document.getElementById(id);
    if (!el) return;
    go(el, false);
    const again = () => { if (location.hash.slice(1) === id && Math.abs(window.scrollY - dest(el)) > 2) place(el); };
    requestAnimationFrame(again);   // the browser's own fragment scroll lands a frame later
    setTimeout(again, 60);
  };

  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.target) return;
    let id = '';
    try { id = decodeURIComponent(a.getAttribute('href').slice(1)); } catch { return; }
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    if (location.hash !== '#' + id) history.pushState(null, '', '#' + id);
    go(el, true);
  });

  addEventListener('popstate', fromHash);
  if (location.hash) { fromHash(); addEventListener('load', fromHash, { once: true }); }
}
