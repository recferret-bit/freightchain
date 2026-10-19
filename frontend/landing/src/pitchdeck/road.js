/* slide 8 – go to market: the truck drives to the exit under the pointer (or a tapped one), honks, mines TEN4 as it drives, and dodges rare obstacles in two lanes;
   the closer to the last exit (TEN4 listing), the faster the road – light-speed streaks, tunnel lamps and the light at the end of the tunnel on the .warp canvas.
   The truck's position is the script's own `--tx` and lane. Rects are read only while a drive or a swerve transition is catching up to that.
   Exit positions are cached, an obstacle's box is worked out from its own position, never read back. The streak gradient is one sprite, reused. */
import { reduced, view, stage, slideOf, everyFrame, replay, shakeScreen } from './core.js';
import { blowCoins } from './coins.js';

const TW = 236;   // the truck's box in the near lane (CSS) – positions are always of this box; the far lane draws it narrower, centred in it
const OB = ['hole', 'cone', 'barrier'], V = 172, SPEED_MAX = 4.5, MINE_EVERY = 5;   // V = the lane markings' 86 px per 0.5 s

export function initRoad(exitsEl) {
  const slide = slideOf(exitsEl), truck = exitsEl.querySelector('.truck'), sv = truck.querySelector('svg'), exits = [...exitsEl.querySelectorAll('.exit')];
  const hwy = truck.parentElement, lanes = hwy.querySelector('.lane'), warp = hwy.querySelector('.warp'), wctx = warp.getContext('2d'), ctl = exitsEl.querySelector('.lanes-ctl');
  const counter = hwy.querySelector('.honks'), cnum = counter.querySelector('b'), obs = [];
  let tx = 0, exitX = [], honks = 0, lastHonk = 0, actx = null, lane = 0, gap = V * 6, lastT = 0, wasOn = false, mineT = 0, laneX = 0, lampX = 0, fShown = 0, kShown = -1;
  let hwW = 0, hwH = 0;
  const measure = () => { exitX = exits.map(ex => ex.offsetLeft + ex.offsetWidth / 2 - TW / 2); };   // the truck's x under each exit (stage px, in the road's frame)
  const sizeRoad = () => { hwW = hwy.clientWidth; hwH = hwy.clientHeight; };
  addEventListener('resize', () => { hwW = 0; measure(); });

  const driveTo = i => {
    const x = exitX[i] ?? 0;
    if (Math.abs(x - tx) < 1) return;
    truck.classList.toggle('back', x < tx); truck.classList.add('go'); tx = x; truck.style.setProperty('--tx', `${x}px`);
  };
  truck.addEventListener('transitionend', e => { if (e.propertyName === 'transform') truck.classList.remove('go', 'back'); });
  exits.forEach((ex, i) => ex.addEventListener('pointerenter', () => driveTo(i)));
  const park = () => { truck.style.transition = 'none'; tx = exitX[0]; truck.style.setProperty('--tx', `${tx}px`); void truck.offsetWidth; truck.style.transition = ''; };   // under EXIT 1, snapped (no drive)
  requestAnimationFrame(() => { measure(); park(); });

  /* the truck HONKS when hovered or tapped: a two-tone air horn synthesized with Web Audio (no file, no request; browsers only let it sound after a click on the page), the cab hops,
     a comic HONK! and sound rings burst from it, the stack puffs, the TEN4 sign hears it – and any SOL coins near the cab are blown into the air */
  const horn = click => {
    try {
      actx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state !== 'running') { if (!click) return; actx.resume(); }   // a hover before any click stays silent (notes queued on a suspended context would all play at once later)
      const t = actx.currentTime, f = actx.createBiquadFilter(), g = actx.createGain();
      f.type = 'lowpass'; f.frequency.value = 1700; f.connect(g).connect(actx.destination);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.12, t + .03); g.gain.setValueAtTime(.12, t + .45); g.gain.exponentialRampToValueAtTime(.001, t + .75);
      for (const hz of [277, 349, 415]) { const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(hz * .93, t); o.frequency.linearRampToValueAtTime(hz, t + .07); o.connect(f); o.start(t); o.stop(t + .78); }   // the air valve opening: each tone slides up into pitch
    } catch { /* no audio: the show goes on */ }
  };
  const honk = click => {
    const now = performance.now(); if (now - lastHonk < 700) return; lastHonk = now;
    horn(click);
    if (reduced) return;
    const x = tx + truck.offsetWidth * .9, y = hwy.offsetTop + truck.offsetTop + truck.offsetHeight * .3;
    sv.animate({ transform: ['none', 'translateY(-16px) rotate(-3deg)', 'none', 'translateY(-5px)', 'none'] }, { duration: 560, easing: 'ease-out' });
    const fx = document.createElement('div'); fx.className = 'honk'; fx.style.left = `${x}px`; fx.style.top = `${y}px`;
    fx.innerHTML = `<b>${Math.random() < .25 ? 'HONK HONK!' : 'HONK!'}</b>${[0, 1, 2].map(k => `<i style="animation-delay:${k * .12}s"></i><em style="animation-delay:${k * .1}s;left:${-58 + (k % 2 ? 8 : -4 * k)}px"></em>`).join('')}`;   // author-made text only
    exitsEl.append(fx); setTimeout(() => fx.remove(), 1300);
    exitsEl.querySelector('.exit.sol')?.animate({ rotate: ['0deg', '-3deg', '2.5deg', '-1.5deg', '0deg'] }, { duration: 600, easing: 'ease-out' });
    const s = stage.getBoundingClientRect(), r = truck.getBoundingClientRect();
    blowCoins((r.left + r.width * .9 - s.left) / view.scale, (r.top - s.top) / view.scale);
  };
  /* driving mines TEN4 (earned by distance, as the spec has it): a TEN4 coin pops off the truck and arcs into the counter – every 5 s under EXIT 1, a second less under each exit on, every 0.5 s under the last */
  const mine = () => {
    const c = document.createElement('i'), x0 = tx + truck.offsetWidth * .35, y0 = hwy.offsetTop + truck.offsetTop - (lane ? 40 : 0), x1 = counter.offsetLeft + cnum.offsetLeft + cnum.offsetWidth / 2, y1 = hwy.offsetTop + counter.offsetTop + 10;
    honk(false);   // the horn, the hop, the HONK! burst (it sounds only once the page has had a click)
    c.className = 'mint'; c.textContent = 'H'; exitsEl.append(c);
    c.animate({ translate: [`${x0}px ${y0}px`, `${(x0 + x1) / 2}px ${Math.min(y0, y1) - 170}px`, `${x1}px ${y1}px`], scale: [.3, 1.25, .55] }, { duration: 1150, easing: 'cubic-bezier(.4,0,.3,1)', fill: 'forwards' }).onfinish = () => {
      c.remove(); counter.classList.add('on'); cnum.textContent = (++honks).toLocaleString('en-US'); counter.animate({ scale: [1, 1.14, 1] }, { duration: 320 });
    };
  };
  /* rare obstacles – a sinkhole, a cone, a barrier – ride the road at the lane markings' speed in one of two lanes (the far one higher and smaller); one ahead in the truck's lane
     lights the ▲ ▼ buttons (the one out of it filled); a press or ↑ / ↓ swerves the truck into the other lane; a miss is a jolt and a tiny screen shake.
     Hits are judged on what is DRAWN: the truck's box on screen, in the lane it visibly is in – so a lane change or a drive only counts once the truck is really there. */
  const swerve = to => { if (to === lane) return; lane = to; truck.classList.toggle('up', !!lane); replay(truck, 'swerve'); setTimeout(() => truck.classList.remove('swerve'), 480); };
  ctl.addEventListener('click', e => { const b = e.target.closest('.ln'); if (b) swerve(b.classList.contains('up') ? 1 : 0); });
  addEventListener('keydown', e => { if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && view.cur === slide) { e.preventDefault(); swerve(e.key === 'ArrowUp' ? 1 : 0); } });
  const streaks = Array.from({ length: 46 }, () => ({ x: Math.random() * 1.2, y: Math.random(), l: .4 + Math.random(), s: .7 + Math.random() * .8 }));
  const streak = document.createElement('canvas'); streak.width = 64; streak.height = 2;   // one purple→clear streak, drawn stretched; k is globalAlpha
  const sg = streak.getContext('2d'), sgG = sg.createLinearGradient(0, 0, 64, 0);
  sgG.addColorStop(0, 'rgba(153,69,255,.95)'); sgG.addColorStop(1, 'rgba(20,241,149,0)'); sg.fillStyle = sgG; sg.fillRect(0, 0, 64, 2);
  let glow = null, glowKey = '';
  const drawWarp = (k, f, dt, W, H) => {
    if (warp.width !== W || warp.height !== H) { warp.width = W; warp.height = H; glow = null; glowKey = ''; }
    wctx.clearRect(0, 0, W, H);
    if (k <= 0) return;
    const key = `${k}:${W}:${H}`;
    if (key !== glowKey) {   // k is already quantized; the end-of-tunnel glow is rebuilt only when that or the size changes
      glowKey = key; glow = wctx.createRadialGradient(W, H / 2, 0, W, H / 2, W * .55);
      glow.addColorStop(0, `rgba(20,241,149,${.4 * k})`); glow.addColorStop(1, 'rgba(20,241,149,0)');
    }
    wctx.fillStyle = glow; wctx.fillRect(0, 0, W, H);
    lampX = (lampX + V * f * 1.6 * dt) % 140; wctx.fillStyle = `rgba(255,207,90,${.85 * k})`;
    for (let x = W - lampX; x > -80; x -= 140) { wctx.fillRect(x, 2, 24 + 46 * k, 3); wctx.fillRect(x, H - 5, 24 + 46 * k, 3); }   // tunnel lamps along both edges
    wctx.globalAlpha = k;
    for (const p of streaks) {   // light-speed streaks, longer the faster
      p.x -= p.s * f * dt * .32; if (p.x < -.3) { p.x = 1.05; p.y = Math.random(); }
      wctx.drawImage(streak, p.x * W, 6 + p.y * (H - 12), 30 + 280 * k * p.l, 2);
    }
    wctx.globalAlpha = 1;
  };
  everyFrame(t => {
    const dt = Math.min(.1, (t - lastT) / 1000) || 0, on = view.cur === slide; lastT = t;
    if (ctl.hidden === on) ctl.hidden = !on;   /* a phone parks this control on the body, so the slide no longer shows and hides it */
    if (on && !wasOn) {   // every visit starts like the first: the truck under EXIT 1 in the near lane, no flipped sign, the honk counter back at zero (the entrance then plays again)
      measure(); sizeRoad(); lane = 0; truck.classList.remove('up', 'go', 'back', 'swerve'); park();
      exits.forEach(e => e.classList.remove('hot')); honks = 0; mineT = 0; counter.classList.remove('on'); cnum.textContent = '0'; exitsEl.querySelectorAll('.mint').forEach(m => m.remove());
    }
    if (!on && wasOn || reduced && on) { obs.splice(0).forEach(o => o.el.remove()); ctl.classList.remove('warn', 'to-up', 'to-dn'); gap = V * 6; }   // a visit opens with 6 s of clear road
    wasOn = on;
    if (!on || reduced) return false;
    if (!hwW) sizeRoad();
    /* READ only while CSS is catching up (the 1.1 s drive, the 0.48 s swerve). Settled, `--tx` and the lane ARE the drawn box. */
    const sc = view.scale; let truckX, vl, tl, tf;
    if (truck.classList.contains('go') || truck.classList.contains('swerve')) {
      const tr = sv.getBoundingClientRect(), hw = hwy.getBoundingClientRect();
      truckX = (tr.left + tr.width / 2 - hw.left) / sc - TW / 2;
      vl = +((hw.bottom - tr.bottom) / sc > 32); tl = (tr.left + tr.width * .05 - hw.left) / sc; tf = (tr.right - tr.width * .07 - hw.left) / sc;
    } else {
      truckX = tx; vl = lane;
      const width = lane ? 203 : TW, left = tx + (lane ? 16.5 : 0);   // .truck.up: narrower, centred by the margin
      tl = left + width * .05; tf = left + width * .93;
    }
    const p = Math.max(0, Math.min(1, (truckX - exitX[0]) / ((exitX[5] - exitX[0]) || 1)));   // how far along to the last exit
    const f = 1 + (SPEED_MAX - 1) * p * p, k = Math.max(0, (p - .3) / .7), atEnd = p > .88 || (p > .5 && Math.abs(tx - exitX[5]) < 2);   // at, or well on the way to, the last exit
    // WRITE
    laneX = (laneX + V * f * dt) % 86; lanes.style.backgroundPosition = `${-laneX}px 0`;   // the markings: 86 px a dash
    if (Math.abs(f - fShown) > .25) { fShown = f; truck.style.setProperty('--f', f.toFixed(2)); }   // wheel speed + glow, in steps (a running animation's duration jumps when changed)
    const kk = Math.round(k * 50) / 50; if (kk !== kShown) { kShown = kk; truck.style.setProperty('--k', kk); }
    drawWarp(k, f, dt, hwW, hwH);
    const near = Math.round(p * 5), every = near === 5 ? .5 : MINE_EVERY - near;   // the exit the truck is under: 5, 4, 3, 2, 1, 0.5 s
    if ((mineT += dt) >= every) { mineT = 0; mine(); }   // reset, not carried over: a shorter interval never fires a burst
    if (!atEnd && (gap -= V * f * dt) <= 0) {   // rare: one every 6–15 s of road – never at the last exit
      const el = document.createElement('i'), l = +(Math.random() < .5); el.className = `ob ${OB[Math.floor(Math.random() * 3)]}${l ? ' far' : ''}`; hwy.append(el);
      const w = el.offsetWidth; obs.push({ el, l, x: hwW + 60, hit: false, off: l ? w * .07 : 0, vw: l ? w * .86 : w }); gap = V * (6 + Math.random() * 9);   // its drawn width: the far lane is scaled .86 about its centre
    }
    let warn = false, free = true;
    for (let i = obs.length - 1; i >= 0; i--) {
      const o = obs[i]; o.x -= V * f * dt; o.el.style.translate = `${o.x.toFixed(1)}px -50%`;
      if (atEnd && !o.hit) { o.hit = true; o.el.classList.add('gone'); }   // the last exit: the road clears
      const ol = o.x + o.off + o.vw * .12, orr = o.x + o.off + o.vw * .88;   // stage px, in the road's frame, same axes as tl / tf
      if (!o.hit && o.l !== lane && orr > tl - 90 && ol < tf + 260) free = false;   // the other lane is not a way out right now
      if (!o.hit && o.l === lane && ol > tf) warn ||= ol - tf < 640 * f ** .5;   // about 3.5 s ahead at 1×, a bit further at speed
      if (!o.hit && o.l === vl && ol <= tf && orr >= tl) { o.hit = true; o.el.classList.add('hit'); sv.animate({ transform: ['none', 'translate(-6px,-10px) rotate(-4deg)', 'translate(4px,0) rotate(2deg)', 'none'] }, { duration: 420, easing: 'ease-out' }); shakeScreen(); }
      if (o.x < -140) { o.el.remove(); obs.splice(i, 1); }
    }
    ctl.classList.toggle('warn', warn); ctl.classList.toggle('to-up', warn && free && !lane); ctl.classList.toggle('to-dn', warn && free && !!lane);   // the way out is filled only when it is clear
    return true;
  });
  truck.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') honk(false); });
  truck.addEventListener('click', e => { e.stopPropagation(); honk(true); });   // a tap is a honk, never a page turn
}
