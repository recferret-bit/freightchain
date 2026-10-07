/* Live dash cards: the game's own cockpit renderer (client/js/cockpit) draws into ONE hidden canvas, and every card copies its crop of it.
   The cockpit modules are singletons that read the global `st` / `dn` / `disp`, so each card keeps its own copy of that state and swaps it in just before its draw.
   No three.js: cockpit/ no longer imports the scene (the windscreen dust colour lives in `weather`). The baked PNGs in the markup stay as the fallback / colour source. */

const W = 1280, H = 633, DPR = 2;   // the design size the crops below were measured at (same as tools/capture-media.mjs)
const FPS = 30;
const SONGS = ['Dust Road Blues', 'Night Shift', 'Long Haul Waltz', 'Neon Mile', 'Cold Start'];
const GEARS = [0, 1, 2, 3, 4, 5, 6, 7, 0, -1];   // the shifter card's loop (0 = neutral, -1 = reverse)
const KMH_AT_2000 = [10, 14, 20, 28, 40, 57, 80];   // km/h per gear at 2000 rpm (AGENTS.md "Gearbox")

/* what each card shows: crop = [x, y, w, h] in design px; tick(t, g) scripts the state (t = seconds, g = the swapped-in globals) */
const SCENES = {
  key: { crop: [794, 536, 164, 97], tick(t, { st }) {   // OFF → key ON (bulb check) → crank → running → OFF, 5 s loop (was 10)
    const c = t % 5; st.keyOn = false; st.engineOn = false; st.ign = null;
    if (c >= .6 && c < 2.9) st.ign = { t: c - .6 }; else if (c >= 2.9 && c < 4.2) { st.engineOn = st.keyOn = true; st.rpm = 700 + Math.sin(t * 9) * 12; } else st.rpm = 0;
  } },
  gear: { crop: [598, 403, 226, 158], tick(t, { st }) {   // 1st → 5th, a rev sweep per gear; speed follows from rpm
    const c = t % 8, g = 1 + Math.floor(c / 1.6), k = (c % 1.6) / 1.6, rpm = 1100 + 1200 * k;
    Object.assign(st, { gear: g, rpm, v: rpm / 2000 * KMH_AT_2000[g - 1] / 3.6, engineOn: true, keyOn: true, park: false, clutch: k < .06 ? 1 : 0, gas: .4 + .4 * k });
  } },
  lamps: { crop: [176, 396, 164, 134], tick(t, { st }) {   // cold engine, strain charging, hot brakes, flat battery; OFF ROAD / OVER-REV / GRIND / STALL now and then
    Object.assign(st, { engineOn: true, keyOn: true, temp: -30, strain: .2 + .7 * (.5 + .5 * Math.sin(t * .8)), brakeT: .45, batt: .25, off: t % 6 > 3, overrev: t % 7 > 5.5, grind: t % 9 > 8 ? .5 : 0, lug: t % 5 > 3 ? .4 : 0 });
  } },
  lights: { crop: [176, 526, 252, 107], tick(t, { st, dn }) {   // night: HEAD / cab light toggling, HEAT warming, pedal bars moving
    Object.assign(dn, { k: 1, night: true, head: t % 6 < 4, cab: t % 8 < 4 });
    Object.assign(st, { engineOn: true, keyOn: true, heater: true, heatEff: .5 + .5 * Math.sin(t * .7), clutch: .5 + .5 * Math.sin(t * 1.3), brake: Math.max(0, Math.sin(t * .7)), gas: .5 + .5 * Math.sin(t * .9 + 1), hull: 82 });
  } },
  park: { crop: [958, 452, 184, 150], tick(t, { st, wip }) {   // PARK on/off, wipers off → 1 → 2, washer, and the shifter walking N → 1…7 → N → R through the H gate
    Object.assign(st, { engineOn: true, keyOn: true, park: t % 6 < 3, washing: t % 6 > 4.5, gear: GEARS[Math.floor(t / 1.1) % GEARS.length] }); wip.mode = Math.floor(t / 2) % 3;
  } },
  trip: { crop: [798, 398, 304, 160], tick(t, { st, radio }) {   // trip km / shift clock running, radio changing station
    Object.assign(st, { engineOn: true, keyOn: true, s: 12000 + t * 28, t: 612 + t }); Object.assign(radio, { on: true, idx: Math.floor(t / 4) % 5, song: { title: SONGS[Math.floor(t / 4) % SONGS.length] } });
  } },
};

export async function startLiveDash(cards) {
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
    const sc = SCENES[el.dataset.live]; if (!sc) continue;
    const [, , cw, ch] = sc.crop, canvas = Object.assign(document.createElement('canvas'), { width: cw * DPR, height: ch * DPR, className: 'live-cv' });
    el.querySelector('.img').append(canvas);
    baseline(); const g = { st, dn, weather, wip, radio }; sc.tick(0, g);
    for (let i = 0; i < 60; i++) updateDisp(.05);   // gauges start where the script puts them, not sweeping up from 0
    panels.push({ el, sc, canvas, c2: canvas.getContext('2d'), s: take(), t: Math.random() * 4, seen: false, active: false, shown: false });
  }

  const draw = (p, dt) => {
    put(p.s); const g = { st, dn, weather, wip, radio };
    p.t += dt; st.t += dt; p.sc.tick(p.t, g); updateDisp(dt);
    const [cx, cy, cw, ch] = p.sc.crop;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath(); ctx.rect(cx * DPR, cy * DPR, cw * DPR, ch * DPR); ctx.clip();   // rasterise only this card's crop
    drawCockpit();
    ctx.restore();
    p.c2.drawImage(cv, cx * DPR, cy * DPR, cw * DPR, ch * DPR, 0, 0, p.canvas.width, p.canvas.height);
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
    p.el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; const on = !p.active; for (const q of panels) q.active = false; p.active = on; });
  }
  let last = performance.now();
  const frame = now => {
    requestAnimationFrame(frame);
    const dt = (now - last) / 1000; if (dt < 1 / FPS - .002 || document.hidden) return;
    last = now; const step = Math.min(dt, .1);
    for (const p of panels) if (!p.shown || (p.seen && p.active && !still)) draw(p, step);   // every card draws one still frame first; reduced motion keeps it that way
  };
  requestAnimationFrame(frame);
}
