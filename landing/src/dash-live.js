/* Live dash cards (what each card shows lives in dash-scenes.js): the game's own cockpit renderer (client/js/cockpit) draws into ONE hidden canvas, and every card copies its crop of it.
   The cockpit modules are singletons that read the global `st` / `dn` / `disp`, so each card keeps its own copy of that state and swaps it in just before its draw.
   No three.js: cockpit/ no longer imports the scene (the windscreen dust colour lives in `weather`). The baked PNGs in the markup stay as the fallback / colour source. */

import { W, H, DPR, SCENES } from './dash-scenes.js';

const FPS = 30;

/* `scenes` = which table the cards' data-live names come from (the landing's by default); `lazy` = a card draws its first still frame only once it is near the viewport (the whitepaper has two dozen of them and no poster images). A scene may add `fit` (object-fit of its canvas), `t0` (the loop second of the still frame) and `mark(t)` (a rect, design px, outlined in amber). Call it ONCE with every card: the cockpit modules are singletons. */
export async function startLiveDash(cards, scenes = SCENES, { lazy = false } = {}) {
  const cv = Object.assign(document.createElement('canvas'), { id: 'cockpit', hidden: true, width: W * DPR, height: H * DPR });
  const toast = Object.assign(document.createElement('div'), { id: 'toast', hidden: true });
  document.body.append(cv, toast);   // the cockpit modules look these up at import time
  const [{ view, ctx }, { drawCockpit }, state, common, { radio }, { wip }] = await Promise.all([
    import('../../client/js/cockpit/canvas.js'), import('../../client/js/cockpit/index.js'), import('../../client/js/state.js'), import('../../client/js/cockpit/common.js'),
    import('../../client/js/sim/radio.js'), import('../../client/js/cockpit/windscreen.js')
  ]);
  const { st, dn, weather, disp, updateDisp, rideStart } = state;
  Object.assign(view, { W, H, DPR });

  /* ── per-card state: baseline + shallow snapshots swapped in and out of the singletons ── */
  const live = { st, dn, weather, wip, keyAnim: common.keyAnim, lever: common.lever, radio, disp };
  const take = () => ({ ...Object.fromEntries(['st', 'dn', 'weather', 'wip', 'keyAnim', 'lever'].map(k => [k, { ...live[k] }])), disp: { ...disp, vel: { ...disp.vel } }, radio: { on: radio.on, idx: radio.idx, song: radio.song } });
  const put = s => { for (const k of ['st', 'dn', 'weather', 'wip', 'keyAnim', 'lever']) Object.assign(live[k], s[k]); Object.assign(disp, s.disp, { vel: s.disp.vel }); Object.assign(radio, s.radio); };
  const baseline = () => {
    Object.assign(st, rideStart({ rpm: 700, engineOn: true, temp: 88, pull: 1 }), { mode: 'menu', park: false, keyOn: true, batt: .8, bugs: [] });
    Object.assign(dn, { k: 0, night: false, head: false, cab: false, blind: 0, hood: 0, phase: 'day' });
    Object.assign(weather, { ambient: 26, snow: 0, grime: '176,146,104' });
    Object.assign(wip, { mode: 0 }); Object.assign(radio, { on: false, idx: 0, song: null });
    Object.assign(common.keyAnim, { pos: 1, t: performance.now() });
  };
  const panels = [];
  for (const el of cards) {
    const sc = scenes[el.dataset.live]; if (!sc) continue;
    const [, , cw, ch] = sc.crop, canvas = Object.assign(document.createElement('canvas'), { width: cw * DPR, height: ch * DPR, className: 'live-cv' });
    if (sc.fit) canvas.style.objectFit = sc.fit;   // 'contain' for a crop much wider than the card
    el.querySelector('.img').append(canvas);
    const t0 = sc.t0 ?? Math.random() * 4; baseline(); const g = { st, dn, weather, wip, radio }; sc.tick(t0, g);
    for (let i = 0; i < 60; i++) updateDisp(.05);   // gauges start where the script puts them, not sweeping up from 0
    panels.push({ el, sc, canvas, c2: canvas.getContext('2d'), s: take(), t: t0, seen: false, active: false, shown: false });
  }

  const draw = (p, dt) => {
    put(p.s); const g = { st, dn, weather, wip, radio };
    p.t += dt; st.t += dt; p.sc.tick(p.t, g); updateDisp(dt);
    const [cx, cy, cw, ch] = p.sc.crop;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath(); ctx.rect(cx * DPR, cy * DPR, cw * DPR, ch * DPR); ctx.clip();   // rasterise only this card's crop
    drawCockpit();
    ctx.restore();
    p.c2.clearRect(0, 0, p.canvas.width, p.canvas.height);   // the cockpit canvas is see-through at the windscreen: without this every frame's glow piles up there
    p.c2.drawImage(cv, cx * DPR, cy * DPR, cw * DPR, ch * DPR, 0, 0, p.canvas.width, p.canvas.height);
    const m = p.sc.mark?.(p.t);
    if (m) { const k = p.canvas.width / cw, c2 = p.c2; c2.save(); c2.globalAlpha = .6 + .4 * Math.sin(p.t * 6); c2.strokeStyle = '#ffcf5a'; c2.lineWidth = 1.5 * DPR; c2.beginPath(); c2.roundRect((m[0] - cx) * k, (m[1] - cy) * k, m[2] * k, m[3] * k, 5 * DPR); c2.stroke(); c2.restore(); }
    p.s = take();
    if (!p.shown) { p.shown = true; p.el.classList.add('rendered'); }
  };

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const io = new IntersectionObserver(es => { for (const e of es) panels.find(p => p.el === e.target).seen = e.isIntersecting; }, { rootMargin: '80px' });
  panels.forEach(p => io.observe(p.el));
  /* animate only while the pointer is over a card, or after a tap (a tap toggles it; tapping another card hands the animation over) */
  for (const p of panels) {
    p.el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') p.active = true; });
    p.el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') p.active = false; });
    p.el.addEventListener('focusin', () => { p.active = true; }); p.el.addEventListener('focusout', () => { p.active = false; });   // keyboard: Tab onto a card
    p.el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; const on = !p.active; for (const q of panels) q.active = false; p.active = on; });
  }
  let last = performance.now();
  const frame = now => {
    requestAnimationFrame(frame);
    const dt = (now - last) / 1000; if (dt < 1 / FPS - .002 || document.hidden) return;
    last = now; const step = Math.min(dt, .1);
    for (const p of panels) if ((!p.shown && (p.seen || !lazy)) || (p.seen && p.active && !still)) draw(p, step);   // every card draws one still frame first; reduced motion keeps it that way
  };
  requestAnimationFrame(frame);
}
