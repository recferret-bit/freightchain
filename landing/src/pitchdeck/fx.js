/* The interactive bits of the slides: floating cards (lean, drag), the "touch me" shakes, the badge carousel, the storybook sneak peek, the 65 / 5 / 20 / 10 bar,
   the live canvas scene and the secret tiers. Each init* finds its elements once. */
import { ACH, achTier, BADGES, STORY } from './data.js';
import { reduced, view, deck, replay, slideOf, everyFrame } from './core.js';
import { bannerFollow } from './coins.js';

/** an <img> on a slide that may not be hydrated yet: src now, or data-src for hydrate() */
const lazySrc = (img, url) => { if (img.closest('.slide')?.dataset.ready) img.src = url; else img.dataset.src = url; };

/* the cards of the .fx slides: the mouse (or the phone's tilt) nudges them – parallax through --px / --py on the slide's .vis */
export let fxVis = [];
export const setTilt = (v, px, py) => { v.style.setProperty('--px', px); v.style.setProperty('--py', py); };
export function initTilt(ids) {
  ids.forEach(id => document.getElementById(`s-${id}`)?.classList.add('fx'));
  fxVis = [...deck.querySelectorAll('.fx .vis')];
  fxVis.forEach(v => {
    v.parentElement.addEventListener('pointermove', e => setTilt(v, (e.clientX / innerWidth - .5).toFixed(3), (e.clientY / innerHeight - .5).toFixed(3)));
    v.parentElement.addEventListener('pointerleave', () => setTilt(v, 0, 0));
  });
}

/* dragging a card: it follows the pointer at about half the distance, trailing behind (a slow lerp), and eases home when let go; the LIVE banner tags along a little */
export const drag = { moved: false };   // the end of a drag is not a tap (read by the click handler)
export function initDrag() {
  const drags = new Map(); let raf = 0;
  const trail = () => {
    let busy = false;
    drags.forEach((d, c) => {
      d.x += (d.tx - d.x) * .06; d.y += (d.ty - d.y) * .06;
      c.style.setProperty('--dx', `${d.x.toFixed(1)}px`); c.style.setProperty('--dy', `${d.y.toFixed(1)}px`); bannerFollow(c, d.x, d.y);
      if (!d.down && Math.abs(d.x) < .3 && Math.abs(d.y) < .3) { c.classList.remove('drag'); c.style.removeProperty('--dx'); c.style.removeProperty('--dy'); bannerFollow(c, null); drags.delete(c); } else busy = true;
    });
    raf = busy ? requestAnimationFrame(trail) : 0;
  };
  deck.querySelectorAll('.fx .shot').forEach(c => {
    c.addEventListener('pointerdown', e => {
      if (e.button) return;
      try { c.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
      drag.moved = false; c.classList.add('drag');
      drags.set(c, { x0: e.clientX, y0: e.clientY, x: drags.get(c)?.x ?? 0, y: drags.get(c)?.y ?? 0, tx: 0, ty: 0, down: true });
      raf ||= requestAnimationFrame(trail);
    });
    c.addEventListener('pointermove', e => {
      const d = drags.get(c); if (!d?.down) return;
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) drag.moved = true;
      d.tx = Math.max(-150, Math.min(150, (e.clientX - d.x0) / view.scale * .5)); d.ty = Math.max(-110, Math.min(110, (e.clientY - d.y0) / view.scale * .5));
    });
    const end = () => { const d = drags.get(c); if (d) { d.down = false; d.tx = d.ty = 0; raf ||= requestAnimationFrame(trail); } };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  });
  addEventListener('pointerdown', e => { if (!e.target.closest('.fx .shot')) drag.moved = false; }, true);   // a drag that ended off a card must not swallow the next click
}

/* everything interactive gives a tiny, tweened shake now and then while its slide is showing – a quiet "touch me". Every element keeps its own random clock (2.2–8 s);
   ONE timer checks them five times a second (none while the tab is hidden). It animates the individual `rotate` property, so it never fights float / lean / zoom. */
export function initShakes(sel) {
  const els = [...deck.querySelectorAll(sel)].map(el => ({ el, slide: slideOf(el), next: 0 }));
  const later = () => performance.now() + 2200 + Math.random() * 5800;
  els.forEach(s => { s.next = later(); });
  if (reduced) return;
  setInterval(() => {
    if (document.hidden) return;
    const now = performance.now();
    for (const s of els) {
      if (now < s.next) continue;
      s.next = later();
      const el = s.el;
      if (s.slide !== view.cur || el.matches(':hover,.hot,.drag') || /\bs-/.test(el.closest('.split')?.className ?? '')) continue;   // not while it is being used
      const a = (0.9 + Math.random() * 0.9) * (Math.random() < .5 ? -1 : 1);   // 0.9–1.8°, either way
      el.animate({ rotate: ['0deg', `${a}deg`, `${-a * .75}deg`, `${a * .5}deg`, `${-a * .25}deg`, '0deg'] }, { duration: 520 + Math.random() * 200, easing: 'ease-out' });
    }
  }, 200);
}

/* the soulbound-NFT card: a carousel of the 31 badges – the middle one big, its neighbours small and dim; every 2.6 s the row slides one place left and the caption follows;
   as the new badge reaches the middle two purple rings ripple out of it and it pops. Five slots (o = −2…2): the one that slid out on the left jumps to the far right, unseen. */
export function initCarousel() {
  const ach = deck.querySelector('.ach'); if (!ach) return;
  const stage = ach.querySelector('.ach-stage'), cap = ach.querySelector('.ach-cap'), N = ACH.length, slide = slideOf(ach);
  let k = 0;
  const badge = i => ACH[((i % N) + N) % N];
  const rings = [0, 1].map(() => { const r = document.createElement('i'); r.className = 'ach-ring'; stage.append(r); return r; });
  const slots = [-2, -1, 0, 1, 2].map(o => { const im = document.createElement('img'); im.className = 'ci'; im.width = im.height = 120; im.alt = ''; stage.append(im); return { im, o }; });
  const place = () => slots.forEach(sl => { sl.im.dataset.o = Math.abs(sl.o) > 2 ? 'x' : sl.o; sl.im.style.setProperty('--o', sl.o); });
  const fill = sl => { const [id, name] = badge(k + sl.o); lazySrc(sl.im, `${BADGES}${id}.svg`); sl.im.alt = name; };
  const caption = () => { const [id, name, desc] = badge(k); cap.querySelector('.at').textContent = achTier(id); cap.querySelector('.an').textContent = name; cap.querySelector('.ad').textContent = desc; };
  slots.forEach(fill); place(); caption();
  if (reduced) return;
  setInterval(() => {
    if (view.cur !== slide || document.hidden) return;   // only while its slide is showing
    k = (k + 1) % N;
    slots.forEach(sl => { sl.o -= 1; });
    place();
    setTimeout(() => { rings.forEach(r => replay(r, 'go')); const mid = slots.find(sl => sl.o === 0)?.im; if (mid) replay(mid, 'pop'); }, 480);   // the new badge has all but reached the middle
    replay(cap, 'swap');   // the caption slides in with the new middle badge
    setTimeout(caption, 180);
    setTimeout(() => {   // the badge that left on the left re-enters on the right, hidden
      const gone = slots.find(sl => sl.o < -2);
      gone.im.style.transition = 'none'; gone.o = 2; fill(gone); place(); void gone.im.offsetWidth; gone.im.style.transition = '';
    }, 720);
  }, 2600);
}

/* the AI + MCP sneak-peek card: while hovered or tapped open it steps through the storybook objects every 1.5 s – a hard swap under a Solana-gradient flash, the name tag with it */
export function initPeek() {
  const pk = deck.querySelector('.peek-card'); if (!pk) return;
  const imgs = [...pk.querySelectorAll('img')], nm = pk.querySelector('.pk-name'), fl = pk.querySelector('.pk-flash'); let n = 0, timer = 0;
  const step = () => { imgs[n].classList.remove('on'); n = (n + 1) % imgs.length; imgs[n].classList.add('on'); nm.textContent = STORY[n][1]; replay(nm, 'flip'); replay(fl, 'go'); };
  const run = () => { if (!timer && !reduced) { step(); timer = setInterval(step, 1500); } };
  const stop = () => { clearInterval(timer); timer = 0; };
  pk.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') run(); });
  pk.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') stop(); });
  pk.addEventListener('click', () => { if (pk.classList.contains('hot')) run(); else stop(); });   // runs after the generic toggle: a tap opens (and runs) or closes it
}

/* the 65 / 5 / 20 / 10 bar – hover (or tap) a block: every other block runs to the bar's border on ITS side of the picked one and squeezes into it (the farthest first, equally
   far ones together), the picked one slides to the left edge and grows to the full width, then its % gives way to what it means; leaving plays it backwards, nearest first */
export let onSplit = () => {};   // pitchdeck.js sets it (analytics): hover and tap both open through expand()
export const setOnSplit = f => { onSplit = f; };
export function initSplit() {
  const split = deck.querySelector('.split'); if (!split) return;
  const blocks = [...split.children];
  let open = -1, timers = [], intent = 0;
  const later = (ms, f) => timers.push(setTimeout(f, ms));
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const expand = i => {
    onSplit();
    clear(); open = i;
    const bar = split.offsetLeft, far = Math.max(...blocks.map((_, k) => Math.abs(k - i)));
    blocks.forEach((b, k) => {
      const d = Math.abs(k - i), left = b.offsetLeft - bar;
      b.classList.toggle('pick', k === i);
      b.style.setProperty('--o', d ? far - d : 0); b.style.setProperty('--r', d ? d - 1 : 0);
      b.style.setProperty('--ox', k < i ? '0%' : '100%');   // it squeezes towards the border it runs to
      b.style.setProperty('--tx', `${k < i ? -left : split.offsetWidth - left - b.offsetWidth}px`);
    });
    if (reduced) { split.classList.add('s-out', 's-grow', 's-text'); return; }
    split.classList.add('s-out');
    later(660, () => split.classList.add('s-grow'));
    later(1420, () => split.classList.add('s-text'));   // the grow (from 660 ms, 0.7 s) has finished: the text never re-wraps while the block is still widening
  };
  const collapse = () => {
    clear(); open = -1;
    if (reduced) { split.classList.remove('s-text', 's-grow', 's-out'); blocks.forEach(b => b.classList.remove('pick')); return; }
    split.classList.remove('s-text');
    later(300, () => split.classList.remove('s-grow'));
    later(1000, () => split.classList.remove('s-out'));
    later(1800, () => blocks.forEach(b => b.classList.remove('pick')));
  };
  blocks.forEach((b, i) => b.addEventListener('pointerenter', e => {
    if (e.pointerType !== 'mouse' || open >= 0) return;
    clearTimeout(intent); intent = setTimeout(() => expand(i), 140);   // a short intent delay: sweeping the pointer across the bar does not fire it
  }));
  split.addEventListener('pointerleave', e => { clearTimeout(intent); if (e.pointerType === 'mouse' && open >= 0) collapse(); });
  let by = 'mouse';
  split.addEventListener('pointerdown', e => { by = e.pointerType; }, { passive: true });   // the click's own pointerType can't be trusted: iOS Safari reports a tap's click as 'mouse', so a second tap never closed it
  split.addEventListener('click', e => {   // a tap: open the block, or close again (a mouse is already driven by hover)
    const i = blocks.indexOf(e.target.closest('.split > div'));
    if (open >= 0) { if (by !== 'mouse') collapse(); } else if (i >= 0) expand(i);
  });
}

/* live canvas scenes lifted from the landing's UNDER THE HOOD cards (src/chain-scenes.js – a lazy chunk the landing shares), drawn straight onto the slide, only while it shows */
export function initScenes() {
  const scenes = [...deck.querySelectorAll('canvas[data-scene]')].map(cv => ({ cv, ctx: cv.getContext('2d'), slide: slideOf(cv), name: cv.dataset.scene, draw: null }));
  if (!scenes.length) return;
  let lib = null;
  (window.requestIdleCallback ?? (f => setTimeout(f, 800)))(() => import('../chain-scenes.js').then(m => {
    lib = m;
    scenes.forEach(sc => { if (sc.ctx?.roundRect) sc.draw = m.SCENES[sc.name]?.(); });   // no roundRect (an old browser): an empty frame
  }).catch(() => {}));
  everyFrame(ms => {
    if (!lib) return;
    for (const sc of scenes) {
      if (!sc.draw || sc.slide !== view.cur) continue;
      const w = Math.round(sc.cv.clientWidth * 2);   // 2× the layout width, so the stage's scaling stays sharp
      if (w && sc.cv.width !== w) { sc.cv.width = w; sc.cv.height = Math.round(w * 124 / 240); }
      lib.drawScene(sc.ctx, sc.draw, reduced ? 3.2 : ms / 1000, sc.cv.width / 240);
    }
  });
}

/* slide 4's FREE / 1 H / 4 H / 8 H are buttons: a click hangs the secret tier under THAT tier on a chain link, its text scrambling before it settles on ???;
   another click on the tier plays that backwards (the text scrambles out, the tile swings back up); a click on a secret tile scrambles it again */
const SCRAMBLE = '#%&@$?<>/\\█▓▒░';
function scramble(el, final, ms, out = false) {   // in: letters lock in left to right; out: they come loose right to left (the text is put back once it is gone)
  const t0 = performance.now(), run = el.dataset.run = String(t0), n = final.length, glyph = () => SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)];
  const step = t => {
    if (el.dataset.run !== run) return;   // a newer scramble took over (a quick re-click)
    const p = (t - t0) / ms;
    el.textContent = p >= 1 ? final : [...final].map((ch, i) => ((out ? p <= (n - i) / (n + 1) : p > (i + 1) / (n + 1)) ? ch : glyph())).join('');
    if (p < 1) requestAnimationFrame(step); else if (out) el.textContent = final;
  };
  requestAnimationFrame(step);
}
const scrambleTile = (li, out = false) => { scramble(li.querySelector('b'), '???', out ? 450 : 700, out); scramble(li.querySelector('span'), 'secret', out ? 550 : 900, out); };
export function ladderClick(li) {
  li.animate({ scale: [1, .92, 1.06, 1] }, { duration: 300, easing: 'ease-out' });
  if (li.closest('.secret')) { if (!reduced) scrambleTile(li); return; }
  const row = li.closest('.ladder'), tile = li.closest('.ladders').querySelectorAll('.secret li')[[...row.children].indexOf(li)];   // the secret under the tier that was clicked
  const open = tile.classList.toggle('open');
  if (!reduced) { if (open) setTimeout(() => scrambleTile(tile), 120); else scrambleTile(tile, true); }   // going: the scramble runs backwards, done before the fade
}
