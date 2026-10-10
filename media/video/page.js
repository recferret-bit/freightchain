// Runs INSIDE play.html after the game booted (injected by capture.mjs). Two halves:
//   director – sets up each scene's real gameplay through window.__game and drives it with a per-step hook (no key-mashing in real time)
//   fx       – the landing-styled overlay (ticker, brand, route chip, step captions, transitions, impact stamp, end card), redrawn from the video time T every frame
// Everything is a pure function of T (never CSS animations: they would run on the wall clock, not the virtual one).
window.__dir = (() => {
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)), ease = x => 1 - (1 - clamp(x)) ** 3, back = x => { x = clamp(x); return 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2; };
  const h = (n, s = 0) => { const x = Math.sin(n * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };   // hash noise, so glitch frames are the same every run
  let spec, sc, k = -1, U = 1, starts = [], ev = null, cur = null, fxEl = {}, log = [];   // log = what really happened in the footage (gear shifts, the crash), read by capture.mjs for the audio's timeline – write-only here, never read back by the sim
  const now = () => +(starts[k] + cur.t).toFixed(3);   // video time of the current step (a function: hook() has its own local `k`)
  const g = () => window.__game, press = code => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  const RATIOS = [0, 6.15, 4.33, 3.05, 2.15, 1.51, 1.065, 0.75], K_RPM = 2400 / (30 * .75);   // mirror of client/js/state.js: rpm = K_RPM · v · ratio
  const gearFor = v => { for (let i = 1; i <= 7; i++) if (K_RPM * v * RATIOS[i] <= 2200) return i; return 7; };   // lowest gear that is not screaming at this speed
  const px = n => `calc(${n}px*var(--u))`;
  const fit = (lines, max, share = .84) => Math.min(max, share * (spec.crop === 'square' ? spec.height : spec.width) / U / (Math.max(...lines.map(l => l.length)) * .64)) * U;   // mono ≈ .6 em + letter-spacing

  /* ───────── overlay DOM (landing tokens: --amber --gear --cream --dim --lcd --lcd-bg, mono) ───────── */
  function build() {
    const css = `
:root{--bg:#0b0a09;--amber:#ffcf5a;--gear:#ffb03a;--needle:#ff7a2e;--cream:#e8e2cf;--dim:#9d957f;--lcd:#7cff7c;--lcd-bg:#0d2410;--red:#d22;--sol:linear-gradient(90deg,#9945FF,#14F195);--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--u:${U}}
#fx,#fx *{box-sizing:border-box;font-family:var(--mono)} #fx{position:fixed;inset:0;z-index:50;pointer-events:none;overflow:hidden;color:var(--cream)}
#toast,#overlay{display:none!important}
#fx .a{position:absolute}
#fx .tick{left:0;right:0;top:0;height:${px(30)};background:var(--lcd-bg);border-bottom:1px solid #1e4a22;color:var(--lcd);font-size:${px(14)};letter-spacing:.5px;white-space:nowrap;overflow:hidden;line-height:${px(30)}}
#fx .brand{left:${px(24)};top:${px(44)};display:flex;gap:${px(10)};align-items:center;color:var(--amber);font-weight:700;letter-spacing:2px;font-size:${px(20)};text-shadow:0 2px 12px #000}
#fx .chip{border:1px solid #ffcf5a55;border-radius:999px;padding:${px(3)} ${px(12)};font-size:${px(13)};letter-spacing:1px;background:#000a;white-space:nowrap}
#fx .chip.lcd{background:var(--lcd-bg);border-color:#1e4a22;color:var(--lcd)} #fx .chip.lcd::before{content:"";display:inline-block;width:${px(7)};height:${px(7)};border-radius:50%;background:var(--lcd);margin-right:${px(7)}}
#fx .sol{right:${px(24)};top:${px(44)};display:flex;align-items:center;gap:${px(9)};padding:${px(6)} ${px(14)};border-radius:999px;background:#0b0a09d9;border:1.5px solid transparent;background-clip:padding-box;position:absolute;font-weight:700;letter-spacing:2px;font-size:${px(15)}}
#fx .sol::before{content:"";position:absolute;inset:-1.5px;border-radius:inherit;background:var(--sol);z-index:-1}
#fx .sol svg{width:${px(22)};height:${px(18)}}
#fx .cap{left:${px(24)};bottom:${px(40)};max-width:${px(760)};padding:${px(16)} ${px(26)} ${px(18)} ${px(22)};background:#0b0a09d9;border-left:${px(6)} solid var(--amber);border-radius:0 ${px(8)} ${px(8)} 0;box-shadow:0 0 ${px(40)} #ffb02e22}
#fx .cap .n{color:var(--needle);font-size:${px(15)};letter-spacing:4px;font-weight:700}
#fx .cap h2{margin:${px(2)} 0 ${px(4)};font-size:${px(46)};line-height:1.05;color:var(--amber);letter-spacing:1px;font-weight:700;text-shadow:0 0 ${px(24)} #ffb02e55;min-height:${px(48)}}
#fx .cap p{margin:0;font-size:${px(20)};color:var(--cream);letter-spacing:.5px}
#fx .cap .bar{height:${px(3)};margin-top:${px(12)};background:var(--sol);transform-origin:0 50%}
#fx .vig{inset:0;background:radial-gradient(ellipse at 50% 55%,#0000 55%,#000b 100%)}
#fx .scan{inset:0;background:repeating-linear-gradient(0deg,#0000 0 ${px(3)},#0000002e ${px(3)} ${px(4)});mix-blend-mode:multiply}
#fx .cover{inset:0;opacity:0}
#fx .bars div{position:absolute;left:0;right:0;mix-blend-mode:screen;opacity:0}
#fx .stamp{left:50%;top:44%;padding:${px(8)} ${px(26)};border:${px(7)} solid var(--red);color:var(--red);font-size:${px(88)};font-weight:700;letter-spacing:6px;background:#0009;white-space:nowrap;text-shadow:0 0 ${px(30)} #d22}
#fx .card{inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${px(20)};text-align:center;background:radial-gradient(ellipse at 50% 40%,#0b0a0966,#0b0a09ee 75%)}
#fx .card .mk{color:var(--gear);font-size:${px(54)};line-height:1;text-shadow:0 0 ${px(30)} #ffb03a88} #fx .card .nm{font-size:${px(22)};letter-spacing:7px;color:var(--amber);font-weight:700}
#fx .card h1{margin:0;font-size:${px(66)};line-height:1.04;letter-spacing:2px;font-weight:700} #fx .card h1 b{color:var(--amber);text-shadow:0 0 ${px(34)} #ffb02e66}
#fx .card h1 .ok{display:inline-block;padding:${px(8)} ${px(26)};border:${px(7)} solid var(--lcd);color:var(--lcd);font-size:${px(78)};letter-spacing:6px;background:#0009;text-shadow:0 0 ${px(30)} #1c8;transform:rotate(-4deg);white-space:nowrap}
#fx .card ol{list-style:none;display:flex;gap:${px(14)};margin:${px(6)} 0 0;padding:0}
#fx .card li{display:flex;gap:${px(10)};align-items:center;padding:${px(11)} ${px(18)};background:#17130fe6;border:1px solid #ffcf5a33;border-radius:${px(8)};font-size:${px(19)};font-weight:700;letter-spacing:1px}
#fx .card li i{font-style:normal;color:var(--needle)}
#fx .cta{margin-top:${px(8)};border:2px solid var(--amber);background:var(--amber);color:#1b1408;font-weight:700;letter-spacing:3px;border-radius:${px(8)};padding:${px(15)} ${px(44)};font-size:${px(30)}}
#fx .card .ft{display:flex;gap:${px(12)};align-items:center;color:var(--dim);font-size:${px(16)};letter-spacing:1px}
#fx .card .ft svg{width:${px(20)};height:${px(16)}}
#fx.sq{left:${(spec.width - spec.height) / 2}px;right:${(spec.width - spec.height) / 2}px}
#fx.big .tick,#fx.big .brand,#fx.big .sol,#fx.big .cap .n,#fx.big .cap p,#fx.big .cap .bar,#fx.big .card .nm,#fx.big .card ol,#fx.big .card .ft{display:none}
#fx.big .cap{left:0;right:0;top:30%;bottom:auto;max-width:none;padding:0;background:none;border:0;border-radius:0;box-shadow:none;text-align:center}
#fx.big .cap h2,#fx.big .card h1{margin:0;min-height:0;white-space:pre-line;line-height:.98;letter-spacing:${px(3)};-webkit-text-stroke:${px(2)} #1b1408;text-shadow:0 ${px(5)} 0 #000,0 0 ${px(10)} #000,0 0 ${px(44)} #000d}
#fx.big .card h1 b{text-shadow:0 ${px(5)} 0 #000,0 0 ${px(10)} #000,0 0 ${px(44)} #ffb02e88}
#fx.big .card .mk{font-size:${px(96)}} #fx.big .cta{font-size:${px(44)};padding:${px(16)} ${px(40)}}
#fx.big .stamp{top:62%;font-size:${px(64)};padding:${px(6)} ${px(20)};border-width:${px(6)}}`;
    const sol = '<svg viewBox="0 0 24 22"><defs><linearGradient id="sg" x1="0" x2="1"><stop offset="0" stop-color="#9945FF"/><stop offset="1" stop-color="#14F195"/></linearGradient></defs><path fill="url(#sg)" d="M4 0H24L20 6H0Z M0 8H20L24 14H4Z M4 16H24L20 22H0Z"/></svg>';
    document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
    document.body.insertAdjacentHTML('beforeend', `<div id="fx">
      <div class="a vig"></div><div class="a scan"></div>
      <div class="a tick"><span id="fx-tk"></span></div>
      <div class="a brand"><span style="color:var(--gear)">⛟</span> FREIGHT CHAIN<span class="chip lcd" id="fx-route"></span></div>
      <div class="sol">${sol} SOLANA</div>
      <div class="a cap" id="fx-cap"><div class="n" id="fx-n"></div><h2 id="fx-h"></h2><p id="fx-p"></p><div class="bar" id="fx-bar"></div></div>
      <div class="a stamp" id="fx-stamp">✖ SHIFT OVER</div>
      <div class="a card" id="fx-card"><div class="mk">⛟</div><div class="nm">FREIGHT CHAIN</div><h1 id="fx-t"></h1><ol id="fx-steps"></ol><div class="cta" id="fx-cta"></div><div class="ft" id="fx-ft">${sol}<span></span></div></div>
      <div class="a bars" id="fx-bars">${'<div></div>'.repeat(7)}</div>
      <div class="a cover" id="fx-cover"></div></div>`);
    const fx = document.getElementById('fx'); if (spec.look === 'big') fx.classList.add('big'); if (spec.crop === 'square') fx.classList.add('sq');
    for (const id of ['tk', 'route', 'cap', 'n', 'h', 'p', 'bar', 'stamp', 'card', 't', 'steps', 'cta', 'ft', 'bars', 'cover']) fxEl[id] = document.getElementById('fx-' + id);
  }

  /* ───────── scene setup / per-step hook ───────── */
  async function setup(s) {
    const G = g(), { st, CFG, dn } = G;
    window.__reseed?.(7919 * (k + 1) + (s.seed ?? 0));   // every scene draws from its OWN random stream (traffic, dust…): a change to the world generator or to an earlier scene no longer reshuffles this one; `seed` on a scene re-rolls just it
    G.CFG.TRAFFIC = s.traffic; st.mode = 'done';
    G.selectTheme(s.route, false);
    if (s.time === 'night' || s.time === 'day') G.setNight(s.time === 'night', true, false); else G.setPhase(s.time);
    dn.run = false; dn.head = s.lights ?? s.time === 'night'; dn.cab = !!s.cab;
    G.startRide(); Object.assign(G.input, { clutch: 0, gas: 0, brake: 0, wash: 0 }); document.getElementById('overlay').classList.add('hide');
    Object.assign(CFG.TRUCK, { MASS: 1, BRAKE: 9, STEER_RATE: 1.8, STEER_RETURN: 3.5, YAW_LAG: 0, CENTRIF: .03 });   // the e2e driver's handling: no launch stall
    Object.assign(st, { engineOn: true, keyOn: true, park: false, rpm: 1500, v: s.speed[0] ?? s.speed, s: G.net.Sm + 260, d: 2.4, psi: 0, gear: s.gear ?? gearFor(s.speed[0] ?? s.speed), temp: s.cold ? G.weather.ambient : 90, hull: 100, slip: false, clutch: 0 });
    dn.head = s.lights ?? s.time === 'night'; dn.cab = !!s.cab;
    cur = { s, t: 0, wip: 0, shift: null, crashed: false, d0: 2.4 };
    window.__hook = hook; ev = [];
    for (let i = 0; i < Math.round(s.preroll * 20); i++) __vstep(50);   // not captured: frost / dust build-up, traffic settling
    cur.t = 0; ev = [...s.events].sort((a, b) => a.t - b.t);
  }
  function hook(dt) {
    if (!cur) return; const { s } = cur, G = g(), st = G.st, a = Array.isArray(s.speed) ? s.speed : [s.speed, s.speed], p = clamp(cur.t / s.dur);
    while (ev.length && ev[0].t <= cur.t) fire(ev.shift());
    if (cur.shift) {   // (physics: input.clutch is a boolean and shiftT keeps the clutch >= .9, so both are overridden) a quick human shift: clutch in (.1 s), lever across, clutch out by .4 s – st.clutch is driven directly, its own spring is too slow for 4 shifts in 3 s
      const c = cur.shift; c.age += dt; const k = c.age < .1 ? c.age / .1 : c.age < .15 ? 1 : 1 - (c.age - .15) / .25;
      st.clutch = clamp(k); G.input.clutch = 0; if (c.age > .3) st.shiftT = 0; if (!c.done && c.age > .1) { G.tryShift(c.gear); if (st.gear !== c.gear) st.gear = c.gear; c.done = true; log.push({ t: now(), type: 'shift', gear: c.gear }); }
      if (c.age > .4) { cur.shift = null; G.input.clutch = 0; st.clutch = 0; }
    }
    if (st.mode === 'drive' && s.auto !== false && !cur.shift && st.gear < 7 && st.rpm > 2350 && !s.events.some(e => e.do === 'gear')) cur.shift = { gear: st.gear + 1, age: 0, done: false };   // the scripted driver upshifts like a human would
    if (st.mode === 'drive') {
      st.v = a[0] + (a[1] - a[0]) * p; st.engineOn = true; st.park = false; G.input.gas = .5; if (!cur.shift) st.slip = false; st.d =   /* the scripted v overrides physics, so the clutch must not stay in 'slip' (rpm would sit at idle) */  2.4 + (s.sway ?? .35) * Math.sin(cur.t * 1.4) + (cur.steer ?? 0); st.psi = 0;
      if (!s.damage) { st.hull = 100; st.offT = 0; st.cracks.length = 0; }   // scenes that are not about damage stay clean
    } else if (!cur.crashed) { cur.crashed = true; cur.crashT = cur.t; log.push({ t: now(), type: 'crash', why: (document.getElementById('overlay')?.textContent || '').replace(/\s+/g, ' ').slice(0, 140) }); }
    document.getElementById('overlay').classList.add('hide');
    cur.t += dt;
  }
  function fire(e) {
    const G = g(), { dn, input } = G;
    if (e.do === 'gear') cur.shift = { gear: e.value, age: 0, done: false };
    else if (e.do === 'lights') dn.head = e.on ?? !dn.head;
    else if (e.do === 'cab') dn.cab = e.on ?? !dn.cab;
    else if (e.do === 'night') G.setNight(e.on, e.instant ?? true, false);
    else if (e.do === 'phase') G.setPhase(e.value);
    else if (e.do === 'wipers') { for (let i = 0; i < (e.mode - cur.wip + 3) % 3; i++) press('KeyR'); cur.wip = e.mode; }
    else if (e.do === 'washer') input.wash = e.on ? 1 : 0;
    else if (e.do === 'heater') press('KeyH');
    else if (e.do === 'spawn') G.spawn(e.type ?? 'sedan', e.preset ?? 'cruise', e.zone ?? 'ahead', e.dist, e.lat);
    else if (e.do === 'steer') cur.steer = e.value;
  }

  /* ───────── overlay drawing, a pure function of the video time T ───────── */
  function draw(T) {
    const s = sc, local = T - starts[k], G = g(), st = G.st, cvs = [document.getElementById('world'), document.getElementById('cockpit')];
    // ticker + route chip
    fxEl.tk.textContent = ((spec.ticker || 'RIDE ◆ COMPETE ◆ WIN PRIZES ◆ ON SOLANA ◆ ').repeat(8)); fxEl.tk.style.cssText = `display:inline-block;transform:translateX(${-((T * 140 * U) % (spec.ticker.length * 8.4 * U))}px)`;
    const th = G.THEMES.find(t => t.id === s.route); fxEl.route.textContent = `${th?.name ?? s.route} · ${Math.round(st.v * 3.6)} KM/H`.toUpperCase();
    // captions
    let cap = null; for (const c of s.captions) if (local >= c.at && local < c.at + c.dur) cap = c;
    fxEl.cap.style.display = cap ? 'block' : 'none';
    if (cap && spec.look === 'big') {   // one huge word block that slams in (no typewriter: the whole word reads at once)
      const l = local - cap.at, out = clamp((cap.dur - l) / .2), z = 1.6 - .6 * back(l / .3);
      fxEl.h.textContent = cap.head; fxEl.h.style.fontSize = fit(cap.head.split('\n'), 150) + 'px';
      fxEl.cap.style.opacity = clamp(l / .08) * out; fxEl.cap.style.transform = `translateY(-50%) scale(${z})`;
    } else if (cap) {
      const l = local - cap.at, inn = back(l / .35), out = clamp((cap.dur - l) / .2), n = Math.floor(l * 34), head = cap.head.slice(0, n);
      fxEl.cap.style.opacity = out; fxEl.cap.style.transform = `translateX(${(inn - 1) * 60 * U}px)`;
      fxEl.n.textContent = cap.n ? `STEP ${cap.n}` : ''; fxEl.n.style.display = cap.n ? '' : 'none'; fxEl.h.textContent = head + (n < cap.head.length || Math.floor(T * 6) % 2 ? '▌' : ' ');
      fxEl.p.style.opacity = clamp((l - cap.head.length / 34) / .25); fxEl.p.textContent = cap.sub;
      fxEl.bar.style.transform = `scaleX(${clamp(l / cap.dur)})`;
    }
    // end card
    const c = s.card; fxEl.card.style.display = c ? 'flex' : 'none';
    if (c) {
      const r = (i, d = .12) => ease((local - i * d) / .4);
      fxEl.t.innerHTML = c.badge ? `<span class="ok">${c.badge}</span>` : (c.title ?? []).map((t, i) => i ? `<b>${t}</b>` : t).join('<br>'); if (spec.look === 'big' && c.title) fxEl.t.style.fontSize = fit(c.title, 130) + 'px'; fxEl.t.style.opacity = r(0); fxEl.t.style.transform = `translateY(${(1 - r(0)) * 30 * U}px)`;
      if (!fxEl.steps.children.length) fxEl.steps.innerHTML = (c.steps ?? []).map((t, i) => `<li><i>${i + 1}</i>${t}</li>`).join('');
      [...fxEl.steps.children].forEach((li, i) => { li.style.opacity = r(i + 1); li.style.transform = `translateY(${(1 - r(i + 1)) * 24 * U}px)`; });
      fxEl.cta.textContent = c.cta; const q = r(4, .1); fxEl.cta.style.opacity = q; fxEl.cta.style.transform = `scale(${(.7 + .3 * back(q)) * (1 + .035 * Math.sin(T * 9) * q)})`; fxEl.cta.style.boxShadow = `0 0 ${(26 + 16 * Math.sin(T * 9)) * U}px #ffb02e88`;
      fxEl.ft.lastChild.textContent = c.foot; fxEl.ft.style.opacity = r(5, .1);
    }
    // grade: blurred road behind the end card, slow push-in on scenes with `push`
    const push = 1 + (s.push ?? 0) * clamp(local / s.dur);
    let tf = `scale(${push})`, fl = c ? 'blur(5px) brightness(.5) saturate(1.2)' : s.grade ?? '';
    // impact: shake + red flash + stamp
    let cover = '', coverA = 0;
    if (cur?.crashed) {
      const ia = T - (starts[k] + cur.crashT), f = clamp(1 - ia / .5);
      tf += ` translate(${(h(T * 60, 1) - .5) * 40 * U * f}px,${(h(T * 60, 2) - .5) * 30 * U * f}px)`; if (ia < .5) { cover = '#ff2a1a'; coverA = f * .7; }
      fxEl.stamp.style.display = ia > .18 ? 'block' : 'none'; fxEl.stamp.style.transform = `translate(-50%,-50%) rotate(-5deg) scale(${.6 + .4 * back((ia - .18) / .25)})`; fxEl.stamp.style.opacity = clamp((ia - .18) / .1);
    } else fxEl.stamp.style.display = 'none';
    // transitions (envelope peaks at the cut, T = starts[k] ± dur/2)
    const tr = s.transition, prevEnd = starts[k], half = tr.dur / 2, off = T - prevEnd;
    let e = tr.type === 'cut' ? 0 : clamp(1 - Math.abs(off) / half), side = off < 0 ? -1 : 1;
    const wrap = spec.loop && k === starts.length - 1, nextAt = wrap ? starts[k] + sc.dur : starts[k + 1];   // loop: the last scene runs into scene 0's transition, whose second half opens the clip
    const next = wrap ? spec.scenes[0].transition : starts[k + 1] != null ? spec.scenes[k + 1].transition : null;   // the NEXT scene's transition starts before the cut, while we still show this scene
    const t2 = next && next.type !== 'cut' && T > nextAt - next.dur / 2 ? (e2 => ({ type: next.type, e: e2, side: -1 }))(clamp(1 - Math.abs(T - nextAt) / (next.dur / 2))) : null;
    const T1 = e > 0 ? { type: tr.type, e, side } : t2;
    const bars = fxEl.bars.children; for (const b of bars) b.style.opacity = 0;
    if (T1) {
      const { type, e: E, side: S } = T1, cv = clamp((E - .55) / .3);
      if (type === 'flash') { cover = '#fff'; coverA = Math.max(coverA, E ** 1.6); }
      else if (type === 'flash-red') { cover = '#ff2a1a'; coverA = Math.max(coverA, E ** 1.4); fl += ` brightness(${1 + E})`; }
      else if (type === 'dip') { cover = '#000'; coverA = Math.max(coverA, E); }
      else if (type === 'glitch') {
        tf += ` translateX(${(h(Math.floor(T * 30), 3) - .5) * 90 * E * U}px) skewX(${(h(Math.floor(T * 30), 4) - .5) * 14 * E}deg)`; fl += ` hue-rotate(${E * 140}deg) saturate(${1 + E * 2.5}) contrast(${1 + E * .6})`;
        [...bars].forEach((b, i) => { const y = h(Math.floor(T * 30) + i, 5) * 100; b.style.opacity = E * .85; b.style.top = y + '%'; b.style.height = (2 + h(i, Math.floor(T * 30)) * 9) + '%'; b.style.background = i % 2 ? '#14F195' : '#9945FF'; b.style.transform = `translateX(${(h(i, Math.floor(T * 30) + 9) - .5) * 40 * U * E}px)`; });
        cover = '#000'; coverA = Math.max(coverA, cv);
      } else if (type === 'whip') { tf += ` translateX(${S * E * 12 * U}%) scale(${1 + E * .12})`; fl += ` blur(${E * 16 * U}px)`; cover = '#ffe9b0'; coverA = Math.max(coverA, cv); }
      else if (type === 'zoom') { tf += ` scale(${1 + E * .7})`; fl += ` blur(${E * 10 * U}px) brightness(${1 + E * 1.6})`; cover = '#fff'; coverA = Math.max(coverA, cv); }
    }
    for (const cv of cvs) { cv.style.transformOrigin = '50% 50%'; cv.style.transform = tf; cv.style.filter = fl.trim() || 'none'; }
    fxEl.cover.style.background = cover || '#000'; fxEl.cover.style.opacity = coverA;
  }

  /* ───────── API used by capture.mjs ───────── */
  return {
    log: () => log,
    async init(sp) { spec = sp; U = sp.height / 720; build(); let a = 0; starts = sp.scenes.map(x => { const r = a; a += x.dur; return r; }); },
    async frame(T, dtMs) {
      let i = starts.length - 1; while (starts[i] > T + 1e-6) i--;
      if (i !== k) { k = i; sc = spec.scenes[k]; await setup(sc); fxEl.steps.innerHTML = ''; }
      __vstep(dtMs); draw(T);
      return { scene: sc.id, mode: g().st.mode, v: +g().st.v.toFixed(1), gear: g().st.gear, rpm: Math.round(g().st.rpm), clutch: +g().st.clutch.toFixed(2), slip: g().st.slip };
    },
  };
})();
