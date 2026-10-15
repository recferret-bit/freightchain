/* Freight Chain pitch deck (pitchdeck.<apex>, landing/pitchdeck.html – the "Poster" theme, src/pitchdeck.css). Makes NO request of its own: every file is the landing build's.
   The slides are author-written constants (pitchdeck/data.js), so they go in with innerHTML (the landing's no-innerHTML rule is for server text; this takes none).
   This file is the engine: it renders the slides, turns pages (bottom-bar arrows, keys, a swipe – never a plain click), loads each slide's media only when it is near,
   scales the 1920×1080 stage, and wires the parts in pitchdeck/*.js. Keys: → / space next · ← back · F fullscreen · Home / End. */
import { SLIDES } from './pitchdeck/data.js';
import { reduced, view, stage, deck, replay, toStage, pop } from './pitchdeck/core.js';
import { initTicker, holdTicker, ticker } from './pitchdeck/ticker.js';
import { initCoins, donate, adopt } from './pitchdeck/coins.js';
import { initTilt, initDrag, drag, initShakes, initCarousel, initPeek, initSplit, initScenes, ladderClick } from './pitchdeck/fx.js';
import { initRoad } from './pitchdeck/road.js';

deck.innerHTML = SLIDES.map((s, i) => `<section class="slide L-${s.layout.split(' ').join(' L-')}" id="s-${s.id}" data-i="${i}">${s.html}</section>`).join('');
const slides = [...deck.children], help = document.getElementById('help');

/* media are lazy (data-src / data-poster in data.js): the showing slide's at once, the slides either side when the browser is idle – the next slide's video only reads its header */
const idle = window.requestIdleCallback ?? (f => setTimeout(f, 300));
function hydrate(i, next = false) {
  const s = slides[i]; if (!s || s.dataset.ready) return;
  s.dataset.ready = '1';
  for (const el of s.querySelectorAll('[data-poster]')) el.poster = el.dataset.poster;
  for (const el of s.querySelectorAll('[data-src]')) { if (next && el.tagName === 'VIDEO') el.preload = 'metadata'; el.src = el.dataset.src; }
}

/* page counter: an old mechanical-watch roll – the digit that changes rolls out and the new one rolls in (up going forward, down going back) while the counter swells 1.05 */
const pager = document.getElementById('pager');
const span = (cls, text = '') => { const e = document.createElement('span'); e.className = cls; e.textContent = text; return e; };
const dgs = [0, 1].map(() => { const dg = span('dg'); dg.append(span('col')); return dg; });
pager.append(...dgs, span('of', ` / ${String(slides.length).padStart(2, '0')}`));
function setPager(i, from) {   // from = the previous slide, -1 on load
  const txt = String(i + 1).padStart(2, '0');
  dgs.forEach((dg, k) => {
    const col = dg.firstElementChild, old = col.dataset.v;
    if (old === txt[k]) return;
    col.dataset.v = txt[k];
    if (from < 0 || reduced || old == null) { col.replaceChildren(span('', txt[k])); col.style.transform = ''; return; }
    const fwd = i > from;
    col.style.transition = 'none';
    col.replaceChildren(...(fwd ? [span('', old), span('', txt[k])] : [span('', txt[k]), span('', old)]));
    col.style.transform = fwd ? 'translateY(0)' : 'translateY(-50%)';
    void col.offsetWidth;
    col.style.transition = 'transform .55s cubic-bezier(.2,.8,.2,1)';
    col.style.transform = fwd ? 'translateY(-50%)' : 'translateY(0)';
  });
  if (from >= 0 && !reduced) replay(pager, 'tick');
}

/* the stage hangs from the top edge (any letterbox goes below), the header ticker hugs the top of the window full width */
const safe = document.getElementById('safe');
const fit = () => {
  const k = view.scale = Math.min(innerWidth / 1920, innerHeight / 1080), w = view.w = Math.max(1920, Math.round(innerWidth / k));   // a screen wider than 16:9 (a phone sideways) widens the stage instead of leaving black bars
  const sa = window.getComputedStyle(safe);   // the notch / home-bar insets (a phone sideways), in stage px: the slides keep clear of them and of the corner buttons
  stage.style.width = `${w}px`; stage.style.setProperty('--ex', `${(w - 1920) / 2}px`);
  stage.style.setProperty('--sl', `${parseFloat(sa.paddingLeft) / k}px`); stage.style.setProperty('--sr', `${parseFloat(sa.paddingRight) / k}px`);
  stage.style.transform = `translate(-50%,0) scale(${k})`;
  ticker.style.transform = `scale(${k})`; ticker.style.width = `${innerWidth / k}px`;
};
addEventListener('resize', fit); fit();

function show(i) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  if (i === view.cur) return;
  hydrate(i);
  idle(() => { hydrate(i + 1, true); hydrate(i - 1); });
  slides.forEach((s, j) => s.classList.toggle('on', j === i));
  for (const v of deck.querySelectorAll('video')) if (slides[i].contains(v)) v.play().catch(() => {}); else v.pause();
  setPager(i, view.cur);
  view.cur = i;
  history.replaceState(null, '', '#' + (i + 1));
  document.getElementById('bar').style.width = `${100 * (i + 1) / slides.length}%`;
}

/* the bottom bar's tip flashes on a ← / → / space press (the corner arrow in that direction too; space leaves the arrows alone) and on the arrows' own click */
function flashTip(dir) {
  replay(help, 'flash');
  if (!dir) return;
  const d = dir === 'go-l' ? -1 : 1;
  for (const b of document.querySelectorAll('.pb')) b.classList.toggle('hit', +b.dataset.go === d);
  if (!reduced) replay(document.getElementById(d < 0 ? 'prev' : 'next'), 'flash');
}
/* full screen: the F key, and on a phone ONE button (top right: on / off) + the first tap turns it on (the browser only allows it from a gesture); iPhone Safari has no API – there the button shows how to Add to Home Screen */
const root = document.documentElement, fsBtn = document.getElementById('fs');
const setFull = on => { if (!root.requestFullscreen) return; (on ? root.requestFullscreen() : document.fullscreenElement ? document.exitFullscreen() : Promise.resolve()).catch(() => {}); };
const syncFull = () => { fsBtn.textContent = document.fullscreenElement ? '✕' : '⛶'; fsBtn.setAttribute('aria-label', document.fullscreenElement ? 'Exit full screen' : 'Full screen'); };
const installed = navigator.standalone || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches, hint = document.getElementById('fs-hint');
fsBtn.hidden = installed;   // opened from the home screen it already is full screen
fsBtn.addEventListener('click', () => { replay(fsBtn, 'flash'); if (root.requestFullscreen) setFull(!document.fullscreenElement); else hint.hidden = !hint.hidden; });   // iPhone Safari: no API – the button explains Add to Home Screen
hint.addEventListener('click', () => { hint.hidden = true; });
document.addEventListener('fullscreenchange', syncFull); syncFull();
addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') flashTip('go-r'); else if (e.key === 'ArrowLeft') flashTip('go-l'); else if (e.key === ' ') flashTip('');
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(view.cur + 1); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key)) show(view.cur - 1);
  else if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
  else if (e.key === 'f' || e.key === 'F') setFull(!document.fullscreenElement);
});

initTicker();
initTilt(['product', 'game', 'insight', 'play', 'money', 'plan']);   // these slides' cards float, lean, lift and can be dragged
initDrag();
initCoins();
const exits = deck.querySelector('.exits'); if (exits) initRoad(exits);
initShakes('.fx .shot, .fx .badge, .fx canvas.glyph, .L-wall .tags span, .split > div, .ladder li, .cards5 .cc, .pts li.don, .pts li.adopt, .exits .exit');
initCarousel(); initPeek(); initSplit(); initScenes();

/* ONE click handler: a click or tap never turns the page – only the bottom bar's arrows (and the keys / a swipe) do; on a card it lifts it (.hot), on a button it does its thing */
const CARDS = '.fx .shot, .fx .badge, .fx canvas.glyph, .L-wall .tags span, .cards5 .cc, .plan .bar, .exits .exit';
addEventListener('click', e => {
  const t = e.target, go = t.closest('[data-go]');
  if (go) { flashTip(+go.dataset.go > 0 ? 'go-r' : 'go-l'); show(view.cur + +go.dataset.go); return; }
  if (t.closest('.split')) return;   // the bar's own click handler (a tap opens / closes a block)
  if (t.closest('#ticker')) { holdTicker(); return; }   // a click on the header slows it for a moment
  if (t.closest('.pts li.don')) { donate(); return; }   // slide 3: a mock donation
  if (t.closest('.pts li.adopt')) { adopt(); return; }   // slide 3: the coins go into Web3 adoption
  const tier = t.closest('.ladder li'); if (tier) { ladderClick(tier); return; }   // slide 4: the tiers are buttons
  const card = t.closest(CARDS);
  if (!card) return;
  if (drag.moved) { drag.moved = false; return; }   // the end of a drag is not a tap
  if (card.classList.contains('badge')) replay(card, 'pop');   // a tween bump on every click
  const on = card.classList.toggle('hot');
  if (on) (card.closest('.vis') ?? card.parentElement).querySelectorAll('.hot').forEach(c => { if (c !== card) c.classList.remove('hot'); });
});

/* phones: a swipe turns the page, the tip says "swipe", a portrait screen is asked to turn sideways, and the first tap goes full screen */
const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
document.body.classList.toggle('touch', touch);
/* a tap on anything that answers it shows a soft Solana-gradient ring instead of the browser's blue highlight (-webkit-tap-highlight-color is off in the CSS) */
const TAPS = `${CARDS}, .pts li.don, .pts li.adopt, .ladder li, .split > div, .exits .exit, [data-go], button`;
if (touch && !reduced) addEventListener('pointerdown', e => { if (e.target.closest?.(TAPS)) { const [x, y] = toStage(e.clientX, e.clientY); pop('tap', '', x, y); } }, { passive: true });
if (touch) addEventListener('pointerup', function first(e) { if (e.target.closest('#fs')) return; removeEventListener('pointerup', first); setFull(true); });
let sx = 0, sy = 0, swipe = false;
addEventListener('touchstart', e => { swipe = !e.target.closest('.fx .shot'); sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
addEventListener('touchend', e => {
  if (!swipe) return;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { flashTip(dx < 0 ? 'go-r' : 'go-l'); show(view.cur + (dx < 0 ? 1 : -1)); }
}, { passive: true });

const turn = document.getElementById('turn'), portrait = matchMedia('(orientation: portrait) and (max-width: 900px)');
let skipTurn = false;
const askTurn = () => { turn.hidden = !(portrait.matches && !skipTurn); };
portrait.addEventListener('change', askTurn); document.getElementById('turn-skip').addEventListener('click', () => { skipTurn = true; askTurn(); }); askTurn();

const fromHash = () => show((parseInt(location.hash.slice(1), 10) || 1) - 1);
addEventListener('hashchange', fromHash);
fromHash();
