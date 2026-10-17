import { $, el } from './dom.js';
import { isMobileDevice } from '../js/mobile.js';

export { $, el };

/* Reusable interactive DOM effects shared across Landing, Whitepaper, and Lobby. */

/** 3D pointer-tilt interaction for .card3d elements (layout-thrash-free rect caching on pointerenter). */
export function bindCard3d(cards = document.querySelectorAll('.card3d'), maxDeg = 11, reduced = false) {
  if (reduced) return;
  for (const card of cards) {
    let r = null;
    card.addEventListener('pointerenter', () => { r = card.getBoundingClientRect(); });
    card.addEventListener('pointermove', e => {
      r ??= card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      card.classList.add('live');
      card.style.setProperty('--rx', `${((0.5 - py) * maxDeg * 2).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${((px - 0.5) * maxDeg * 2).toFixed(2)}deg`);
    });
    card.addEventListener('pointerleave', () => {
      r = null;
      card.classList.remove('live');
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', 'var(--base, 0deg)');
    });
  }
}

/** 3D flip-card click/tap/keyboard toggle (ignores clicks on inner links/buttons, syncs aria-expanded). */
export function bindFlipCards(cards, { onOpen, hoverDwellMs = 0 } = {}) {
  for (const c of cards) {
    let dwell = 0;
    const flip = () => {
      const open = c.classList.toggle('flip');
      if (c.hasAttribute('aria-expanded')) c.setAttribute('aria-expanded', String(open));
      if (open) onOpen?.(c);
    };
    c.addEventListener('click', e => { if (!e.target.closest('a, button')) flip(); });
    c.addEventListener('keydown', e => { if (e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); flip(); } });
    if (hoverDwellMs > 0 && onOpen) {
      c.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') dwell = setTimeout(() => onOpen(c), hoverDwellMs); });
      c.addEventListener('pointerleave', () => clearTimeout(dwell));
    }
  }
}

/** Scroll-reveal observer for .rv elements. */
export function bindReveal(selector = '.rv') {
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(es => {
    for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll(selector).forEach(n => io.observe(n));
}

/** Lazy image rotator for multi-shot preview bands (e.g. .deck-shot img). */
export function bindShotRotator(selector, intervalMs = 4000, reduced = false) {
  const shots = [...document.querySelectorAll(selector)];
  if (shots.length <= 1 || reduced) return;
  let i = 0; shots[0].classList.add('on');
  setInterval(() => {
    const n = shots[(i + 1) % shots.length];
    if (!n.getAttribute('src')) n.src = n.dataset.src;
    shots[i].classList.remove('on'); i = (i + 1) % shots.length; shots[i].classList.add('on');
  }, intervalMs);
}

/** IntersectionObserver scrollspy that toggles .on on navigation links matching visible section[id] elements. */
export function bindScrollSpy(links, { rootMargin = '-35% 0px -55% 0px', onSection } = {}) {
  if (!('IntersectionObserver' in window)) return;
  const list = [...links];
  const so = new IntersectionObserver(es => {
    for (const e of es) if (e.isIntersecting) {
      list.forEach(a => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
      onSection?.(e.target.id);
    }
  }, { rootMargin });
  document.querySelectorAll('section[id]').forEach(s => so.observe(s));
}

/** One-shot IntersectionObserver that invokes fn() once when target enters rootMargin. */
export function observeOnce(target, fn, rootMargin = '300px') {
  if (!target) return;
  if (!('IntersectionObserver' in window)) { fn(); return; }
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin });
  io.observe(target);
}

/** Guards a play/practice action on mobile devices by showing the mobile toast instead of navigating to the desktop-only cab. */
export function guardMobilePlay(e, opts, onDesktop) {
  if (isMobileDevice()) {
    e?.preventDefault?.();
    opts?.onMobile?.();
    const base = opts?.siteBase ?? '';
    import('../js/mobile.js').then(({ showMobileToast }) => showMobileToast({
      liveAction: opts?.liveAction ?? `${base}/lobby.html#live`,
      replaysAction: opts?.replaysAction ?? `${base}/lobby.html#replays`,
    }));
    return true;
  }
  onDesktop?.();
  return false;
}
