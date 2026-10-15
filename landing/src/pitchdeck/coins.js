/* slide 3's money show. DONATIONS drops SOL coins onto the stage: discs under gravity that bounce, roll and pile up between its walls over every slide (at most COIN_MAX,
   the oldest go first), bounce off the showing slide's cards, and can be grabbed and thrown. WEB3 ADOPTION pulls them into the bullet and pays out their real value.
   The LIVE banner runs from the mouse, and it and the clip card are springs that sag under the SOL lying on them. */
import { DONATE, SOL_USD } from './data.js';
import { reduced, view, stage, deck, toStage, slideOf, everyFrame, pop, toast, shakeScreen } from './core.js';

const usd = v => `$${v.toFixed(2)}`;
const COIN_MAX = 120, G = 2600, FLOOR = 1075, CEIL = 40, E_FLOOR = .45, E_COIN = .3;   // G in stage px/s²; the floor sits on the progress bar, the ceiling under the ticker
const CARD_SEL = ':is(.shot, .badge, .cc, .ladder li, .split > div, .tags span, .exit .sign)';   // what the coins bounce off on the showing slide
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', b58 = n => Array.from({ length: n }, () => B58[Math.floor(Math.random() * 58)]).join('');
const coins = [], sucking = [];   // sucking = coins on their way into Web3 adoption
const coinCv = document.createElement('canvas'), cctx = coinCv.getContext('2d');
const sprite = (() => {   // one 128 px sprite: the Solana mark on a dark face inside a purple→green rim, a soft highlight on top
  const S = 128, c = document.createElement('canvas'), g = c.getContext('2d'); c.width = c.height = S;
  const sol = g.createLinearGradient(0, S, S, 0); sol.addColorStop(0, '#9945ff'); sol.addColorStop(1, '#14f195');
  const disc = (r, fill) => { g.beginPath(); g.arc(S / 2, S / 2, r, 0, 7); g.fillStyle = fill; g.fill(); };
  disc(S / 2 - 1, sol); disc(S / 2 - 9, '#0b0a12');
  g.fillStyle = sol;
  const bar = (y, back) => { const x0 = 34, x1 = 94, h = 13, k = 12; g.beginPath(); if (back) { g.moveTo(x0, y); g.lineTo(x1 - k, y); g.lineTo(x1, y + h); g.lineTo(x0 + k, y + h); } else { g.moveTo(x0 + k, y); g.lineTo(x1, y); g.lineTo(x1 - k, y + h); g.lineTo(x0, y + h); } g.fill(); };
  bar(37, false); bar(57.5, true); bar(78, false);
  const hi = g.createRadialGradient(S * .35, S * .3, 2, S * .35, S * .3, S * .6); hi.addColorStop(0, '#ffffff40'); hi.addColorStop(1, '#fff0');
  disc(S / 2 - 1, hi);
  return c;
})();
let coinK = 1, coinRaf = 0, coinStill = 0, coinT = 0;
let held = null, hx = 0, hy = 0, eatClick = false, touchCoin = false;
let boxes = [], boxEls = [], boxSlide = -1, boxTouch = false;
const weighed = [];   // the page-3 card and banner: spring bodies that sag under the SOL lying on them

/** wake the pile (it sleeps once settled) */
export const wakeCoins = () => { coinStill = 0; coinRaf ||= requestAnimationFrame(coinTick); };

function drawCoins() {
  cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.clearRect(0, 0, coinCv.width, coinCv.height);
  const draw = (c, k, ox, oy) => { const cs = Math.cos(c.a) * k, sn = Math.sin(c.a) * k; cctx.setTransform(cs, sn, -sn, cs, ox, oy); cctx.drawImage(sprite, -c.r, -c.r, c.r * 2, c.r * 2); };
  for (const c of coins) draw(c, coinK, c.x * coinK, c.y * coinK);
  for (const { c, sc, al } of sucking) { cctx.globalAlpha = al; draw(c, coinK * sc, c.x * coinK, c.y * coinK); }
  cctx.globalAlpha = 1;
}
const coinFit = () => { coinK = Math.min(2, devicePixelRatio * view.scale); coinCv.width = Math.round(1920 * coinK); coinCv.height = Math.round(1080 * coinK); drawCoins(); };   // backing store at screen resolution, drawn in stage px

function collide(p, q) {   // two discs, mass ∝ area (a held one is immovable): push apart, then a restitution impulse along the normal
  const dx = q.x - p.x, dy = q.y - p.y, rr = p.r + q.r, d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr || d2 === 0) return;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ip = p === held ? 0 : 1 / (p.r * p.r), iq = q === held ? 0 : 1 / (q.r * q.r), push = (rr - d) * .9 / (ip + iq);
  p.x -= nx * push * ip; p.y -= ny * push * ip; q.x += nx * push * iq; q.y += ny * push * iq;
  const vn = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
  if (vn < 0) { const j = -(1 + E_COIN) * vn / (ip + iq); p.vx -= j * nx * ip; p.vy -= j * ny * ip; q.vx += j * nx * iq; q.vy += j * ny * iq; }
  p.touch = q.touch = true;
}
/* the showing slide's cards as boxes in stage px, read once a frame (they float, lean, lift and get dragged): centre, half size and tilt from the element's own transform, its corner radius.
   The element list is looked up once per slide; all reads happen together, before the physics writes anything. */
function readBoxes() {
  if (boxSlide !== view.cur) { boxSlide = view.cur; boxEls = [...(deck.children[view.cur]?.querySelectorAll(CARD_SEL) ?? [])]; }
  const s = stage.getBoundingClientRect(), k0 = view.scale;
  boxes = boxEls.map(el => {
    const r = el.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h || !r.width) return null;
    const cs = window.getComputedStyle(el), m = cs.transform === 'none' ? null : new window.DOMMatrixReadOnly(cs.transform), th = m ? Math.atan2(m.b, m.a) : 0, co = Math.cos(th), si = Math.sin(th);
    const k = r.width / k0 / (w * Math.abs(co) + h * Math.abs(si));   // its own scale (a lifted card is bigger)
    return { el, x: (r.left + r.width / 2 - s.left) / k0, y: (r.top + r.height / 2 - s.top) / k0, hw: w * k / 2, hh: h * k / 2, co, si, rad: Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2) * k };
  }).filter(Boolean);
}
function hitBox(c, b) {   // a disc against a tilted rounded box: into the box's frame, the closest point on the inner box, out along the normal, bounce
  const dx = c.x - b.x, dy = c.y - b.y, lx = dx * b.co + dy * b.si, ly = -dx * b.si + dy * b.co, ix = b.hw - b.rad, iy = b.hh - b.rad, R = c.r + b.rad;
  if (Math.abs(lx) > ix + R || Math.abs(ly) > iy + R) return;
  const qx = Math.max(-ix, Math.min(ix, lx)), qy = Math.max(-iy, Math.min(iy, ly)), d = Math.hypot(lx - qx, ly - qy);
  let nx, ny, pen;
  if (d > 1e-6) { if (d >= R) return; nx = (lx - qx) / d; ny = (ly - qy) / d; pen = R - d; }
  else { const px = ix - Math.abs(lx), py = iy - Math.abs(ly); if (px < py) { nx = Math.sign(lx) || 1; ny = 0; pen = px + R; } else { nx = 0; ny = Math.sign(ly) || 1; pen = py + R; } }   // centre inside: out through the nearest side
  const wx = nx * b.co - ny * b.si, wy = nx * b.si + ny * b.co, vn = c.vx * wx + c.vy * wy;   // the normal back in stage axes
  c.x += wx * pen; c.y += wy * pen;
  if (vn < 0) { const e = vn < -90 ? E_FLOOR : 0; c.vx -= (1 + e) * vn * wx; c.vy -= (1 + e) * vn * wy; }
  c.touch = true; boxTouch = true;
  if (b.el._p && wy < -.5) b.el._p.load += (1 + 8 * (c.v ?? 0)) / 4;   // a coin lying on top of a weighed card: its weight (heavier for more SOL); /4 = the frame's 4 substeps
}
function bounds(c, h) {
  if (c.y - c.r >= CEIL) c.in = true;   // the ceiling only once a coin has dropped in: they are born above it
  if (c.in && c.y - c.r < CEIL) { c.y = CEIL + c.r; if (c.vy < 0) c.vy = -c.vy * E_FLOOR; }
  if (c.y + c.r > FLOOR) { c.y = FLOOR - c.r; if (c.vy > 0) c.vy = c.vy > 90 ? -c.vy * E_FLOOR : 0; c.touch = true; }   // a slow landing stops dead: no endless micro-bounce
  if (c.x - c.r < 0) { c.x = c.r; if (c.vx < 0) c.vx = -c.vx * E_FLOOR; } else if (c.x + c.r > 1920) { c.x = 1920 - c.r; if (c.vx > 0) c.vx = -c.vx * E_FLOOR; }
  if (c.touch) { c.vx *= 1 - .5 * h; c.w += (c.vx / c.r - c.w) * Math.min(1, 10 * h); } else c.w *= 1 - .3 * h;   // touching something it rolls (spin = v / r) and slowly loses speed; in the air it keeps its spin
}
function coinTick(t) {
  const dt = Math.min(1 / 30, (t - coinT) / 1000 || 1 / 60), h = dt / 4; coinT = t;
  readBoxes(); boxTouch = false; for (const p of weighed) p.load = 0;
  if (suckOn) suckStep(t);
  for (let s = 0; s < 4; s++) {   // 4 substeps a frame, 4 collision passes each: enough for a stable pile of ~120
    for (const c of coins) { if (c === held) { c.vx = Math.max(-4000, Math.min(4000, (hx - c.x) * 20)); c.vy = Math.max(-4000, Math.min(4000, (hy - c.y) * 20)); } else c.vy += G * h; c.x += c.vx * h; c.y += c.vy * h; c.a += c.w * h; c.touch = false; }
    for (let it = 0; it < 4; it++) for (let i = 0; i < coins.length; i++) for (let j = i + 1; j < coins.length; j++) collide(coins[i], coins[j]);
    for (const c of coins) { for (const b of boxes) hitBox(c, b); bounds(c, h); }
  }
  let vmax = 0; for (const c of coins) vmax = Math.max(vmax, Math.abs(c.vx), Math.abs(c.vy), Math.abs(c.w * c.r));
  coinStill = vmax < 20 && !held && !boxTouch && !suckOn ? coinStill + 1 : 0;   // coins on a card never sleep: the card floats under them
  drawCoins();
  coinRaf = coinStill > 60 ? 0 : requestAnimationFrame(coinTick);   // a settled pile sleeps until the next donation
}
const coinAt = (x, y) => { for (let i = coins.length - 1; i >= 0; i--) { const c = coins[i]; if ((c.x - x) ** 2 + (c.y - y) ** 2 < c.r * c.r) return c; } return null; };

/** the honk blows the coins near (X, Y) – stage px – into the air; true if any was hit */
export function blowCoins(X, Y) {
  let hit = false;
  for (const c of coins) { const dx = c.x - X, dy = c.y - Y, d = Math.hypot(dx, dy) || 1; if (d < 520) { const k = (1 - d / 520) * 1700; c.vx += dx / d * k; c.vy += dy / d * k - 900 * (1 - d / 520); hit = true; } }
  if (hit) wakeCoins();
}

/* the Donations bullet feels the weight of the SOL: every donation drops one more notch (6 px, up to four) on a slow 1.4 s tween; a notch lifts again every 2.4 s, so it creeps back up on its own */
let donLi = null, donWeight = 0, donLift = 0;
function weighBullet() {
  if (!donLi || reduced) return;
  const put = () => { donLi.style.translate = donWeight ? `0 ${donWeight * 6}px` : ''; };
  donWeight = Math.min(4, donWeight + 1); put();
  clearInterval(donLift); donLift = setInterval(() => { donWeight = Math.max(0, donWeight - 1); put(); if (!donWeight) clearInterval(donLift); }, 2400);
}
/** a click on DONATIONS: a mock donation – a toast at the real SOL price and a handful of coins from above the stage */
export function donate() {
  weighBullet();
  const [what, sol] = DONATE[Math.floor(Math.random() * DONATE.length)];
  toast(`+${sol.toFixed(2)} SOL`, `${what} · ${usd(sol * SOL_USD)} · ${b58(4)}…${b58(4)}`); shakeScreen();
  if (reduced) return;
  const n = 5 + Math.floor(Math.random() * 5);
  for (let i = n; i > 0; i--) coins.push({ v: sol / n, x: 120 + Math.random() * 1680, y: -60 - Math.random() * 520, vx: (Math.random() - .5) * 260, vy: Math.random() * 200, r: 18 + Math.random() * 12, a: Math.random() * 6.3, w: (Math.random() - .5) * 8 });
  coins.splice(0, Math.max(0, coins.length - COIN_MAX));
  wakeCoins();
}

/* WEB3 ADOPTION pulls every coin into it, one by one (nearest first) – each curves in, speeding up, shrinks to 0.1 and fades as it arrives, and pays out its real value:
   a "+$" and a bill pop out of the bullet, which gulps. A total toast once the stage is empty. */
const SUCK_MS = 1100, SUCK_FLY = .7;   // a coin's whole tween; the share of it spent flying (the rest: shrinking and fading at the bullet)
let suckOn = false, suckNext = 0, suckEvery = 200, suckUsd = 0, suckSol = 0, adoptLi = null, sink = null;
export function adopt() {
  if (suckOn) return;
  if (!coins.length) { toast('NO SOL YET', 'CLICK DONATIONS FIRST'); return; }
  if (reduced) { const sol = coins.reduce((a, c) => a + c.v, 0); coins.length = 0; drawCoins(); toast(`+${usd(sol * SOL_USD)}`, `${sol.toFixed(2)} SOL ADOPTED · @ ${usd(SOL_USD)}`); return; }
  suckOn = true; suckNext = 0; suckUsd = 0; suckSol = 0; suckEvery = Math.max(90, Math.min(260, 9000 / coins.length));   // the whole pile in about 9 s, never faster than 90 ms a coin
  wakeCoins();
}
function payOut(x, y, sol) {   // one coin in: its real value at the SOL price as "+$", a bill thrown up and out, the bullet gulps
  const dollars = sol * SOL_USD; suckUsd += dollars; suckSol += sol;
  pop('usd', `+${usd(dollars)}`, x + (Math.random() - .5) * 60, y - 10).style.setProperty('--dx', `${(Math.random() - .5) * 90}px`);
  const b = pop('bill', '💵', x, y);
  b.style.setProperty('--dx', `${(Math.random() - .5) * 420}px`); b.style.setProperty('--dy', `${-120 - Math.random() * 200}px`); b.style.setProperty('--rot', `${(Math.random() - .5) * 720}deg`);
  adoptLi.animate({ scale: [1, 1.1, 1] }, { duration: 240, easing: 'ease-out' });
}
function suckStep(t) {
  const r = sink.getBoundingClientRect(), [tx, ty] = toStage(r.left + r.width / 2, r.top + r.height / 2);
  if (t >= suckNext && coins.length) {   // the next coin: the nearest one not in a hand
    let best = -1, bd = Infinity;
    coins.forEach((c, i) => { const d = (c.x - tx) ** 2 + (c.y - ty) ** 2; if (c !== held && d < bd) { bd = d; best = i; } });
    if (best >= 0) { const [c] = coins.splice(best, 1); sucking.push({ c, x0: c.x, y0: c.y, t0: t, bend: (Math.random() - .5) * 320, sc: 1, al: 1, got: false }); }
    suckNext = t + suckEvery;
  }
  for (let i = sucking.length - 1; i >= 0; i--) {
    const s = sucking[i], c = s.c, p = Math.min(1, (t - s.t0) / SUCK_MS), m = Math.min(1, p / SUCK_FLY), e = m * m * m;   // ease-in: a vacuum pulls harder the closer it gets
    const dx = tx - s.x0, dy = ty - s.y0, len = Math.hypot(dx, dy) || 1, off = Math.sin(Math.PI * m) * s.bend;
    c.x = s.x0 + dx * e - dy / len * off; c.y = s.y0 + dy * e + dx / len * off; c.a += .08 + m * .5;
    if (m < 1) s.sc = 1 - .4 * e;
    else {
      const q = (p - SUCK_FLY) / (1 - SUCK_FLY); s.sc = .6 - .5 * q; s.al = 1 - q;
      if (!s.got) { s.got = true; payOut(tx, ty, c.v); }
    }
    if (p >= 1) sucking.splice(i, 1);
  }
  if (!coins.length && !sucking.length) { suckOn = false; toast(`+${usd(suckUsd)}`, `${suckSol.toFixed(2)} SOL · ADOPTED @ ${usd(SOL_USD)}`); }
}

/* the LIVE banner runs from the mouse (up to ~80 stage px within ~350 px of it, rightwards capped at 32 – the stage edge). Its flee target is worked out in pointermove,
   so a still mouse costs no layout read; every frame only eases towards it. */
let badge = null, badgeSlide = -1;
const bd = { x: 0, y: 0, tx: 0, ty: 0 };
function fleeFrom(e) {
  if (!badge || e.pointerType === 'touch' || view.cur !== badgeSlide) { bd.tx = bd.ty = 0; return; }
  const r = badge.getBoundingClientRect(), R = 352 * view.scale;
  const dx = r.left + r.width / 2 - bd.x * view.scale - e.clientX, dy = r.top + r.height / 2 - bd.y * view.scale - e.clientY, dist = Math.hypot(dx, dy) || 1;   // from the resting centre
  if (dist < R) { const push = 80 * (1 - dist / R) ** 1.2; bd.tx = Math.min(32, dx / dist * push); bd.ty = dy / dist * push; } else bd.tx = bd.ty = 0;
}
/* SOL on the page-3 card and the LIVE banner: the coins resting on top load them, and each is a spring that RESISTS – it sags until the spring pushes back as hard as the SOL
   pushes down (a banner is light, the card is stiff), rings a little, and with the coins gone (adopted) it springs back home. Enough SOL pushes either one down to the ground.
   At rest with no SOL anywhere, nothing here runs. */
let lastW = 0;
function weighBodies(nowT) {
  const dt = Math.min(.04, (nowT - (lastW || nowT)) / 1000); lastW = nowT;
  const empty = !coins.length && !sucking.length;
  for (const p of weighed) {
    if (empty) p.load = 0;
    if (empty && !p.y && !p.vy && !p.sm) continue;   // at rest: no reads, no writes
    p.sm += (p.load - p.sm) * Math.min(1, (p.load > p.sm ? 8 : 1.1) * dt);   // the weight builds fast and lingers (~1 s): a coin rolling off must not make the card flicker
    if (p.ground == null) { const r = p.el.getBoundingClientRect(), [, bottom] = toStage(0, r.bottom); p.ground = Math.max(0, FLOOR - 14 - (bottom - p.y - (p.el === badge ? bd.y : 0))); }   // read once per weighing, not per frame
    const c = 2 * Math.sqrt(p.k) * .42;   // under-damped: a little bounce when the weight comes and goes
    const a = (reduced ? 0 : p.sm * p.f) - p.k * p.y - c * p.vy;
    p.vy += a * dt; p.y += p.vy * dt;
    if (p.y > p.ground) { p.y = p.ground; if (p.vy > 0) p.vy = -p.vy * .2; }   // the ground
    if (p.y < 0) { p.y = 0; if (p.vy < 0) p.vy *= -.15; }
    if (Math.abs(p.y) < .05 && Math.abs(p.vy) < .5 && p.sm < .01) { p.y = 0; p.vy = 0; p.sm = 0; p.ground = null; }
    if (p.el !== badge) p.el.style.setProperty('--wy', `${p.y.toFixed(1)}px`);
  }
}

export function initCoins() {
  coinCv.id = 'coins'; coinCv.setAttribute('aria-hidden', 'true'); stage.insertBefore(coinCv, document.getElementById('pager'));
  addEventListener('resize', coinFit); coinFit();
  donLi = deck.querySelector('.pts li.don'); adoptLi = deck.querySelector('.pts li.adopt'); sink = adoptLi?.querySelector('.sink');
  badge = deck.querySelector('.fx .badge'); badgeSlide = slideOf(badge);
  const clip = deck.querySelector('#s-insight .shot.clip');
  for (const [el, k, f] of [[badge, 8, 1500], [clip, 18, 2300]]) if (el) { el._p = { el, y: 0, vy: 0, load: 0, sm: 0, k, f, ground: null }; weighed.push(el._p); }
  addEventListener('resize', () => weighed.forEach(p => { p.ground = null; }));

  /* every coin can be grabbed: a press on one (the topmost) holds it – it chases the pointer, shoves the others aside and is thrown with its last velocity on release.
     A grab is never a page turn, a swipe or a card drag: the press, its click and its touches stop at the window (capture). */
  addEventListener('pointerdown', e => {
    if (!coins.length) { eatClick = false; return; }
    const [x, y] = toStage(e.clientX, e.clientY), c = !e.button && coinAt(x, y);
    eatClick = !!c; if (!c) return;
    e.stopPropagation(); e.preventDefault();
    held = c; hx = x; hy = y; touchCoin = e.pointerType === 'touch';
    coins.splice(coins.indexOf(c), 1); coins.push(c);   // drawn on top
    stage.classList.add('coin-drag'); wakeCoins();
  }, true);
  addEventListener('pointermove', e => {
    fleeFrom(e);
    if (!coins.length) return;
    const [x, y] = toStage(e.clientX, e.clientY);
    if (held) { hx = x; hy = y; } else stage.classList.toggle('coin-over', !!coinAt(x, y));
    wakeCoins();   // a hovered or dragged card may shove the pile
  });
  document.documentElement.addEventListener('pointerleave', () => { bd.tx = bd.ty = 0; });
  new window.MutationObserver(() => { if (coins.length) wakeCoins(); }).observe(deck, { subtree: true, attributeFilter: ['class'] });   // another slide, other cards: wake the pile
  const letGo = () => { if (held) { held = null; stage.classList.remove('coin-drag'); } };
  addEventListener('pointerup', letGo); addEventListener('pointercancel', letGo);
  addEventListener('click', e => { if (eatClick) { eatClick = false; e.stopPropagation(); } }, true);
  addEventListener('touchstart', e => { if (touchCoin) e.stopPropagation(); }, { capture: true, passive: true });
  addEventListener('touchend', e => { if (touchCoin) { touchCoin = false; e.stopPropagation(); } }, { capture: true, passive: true });

  let still = false;
  if (badge) everyFrame(t => {
    if (view.cur !== badgeSlide) bd.tx = bd.ty = 0;
    const idle = !bd.tx && !bd.ty && Math.abs(bd.x) < .05 && Math.abs(bd.y) < .05;
    if (idle) bd.x = bd.y = 0; else { bd.x += (bd.tx - bd.x) * .14; bd.y += (bd.ty - bd.y) * .14; }
    weighBodies(t);
    const y = badge._p?.y ?? 0, now = idle && !y;
    if (now && still) return;   // nothing moved since the last write: no style write either
    still = now;
    badge.style.setProperty('--bx', `${bd.x.toFixed(1)}px`); badge.style.setProperty('--by', `${(bd.y + y).toFixed(1)}px`);
  });
}
/** the card drag lets the LIVE banner tag along a little */
export const bannerFollow = (card, x, y) => { const b = card.closest('.vis')?.querySelector('.badge'); if (!b) return; if (x === null) { b.style.removeProperty('--fx'); b.style.removeProperty('--fy'); } else { b.style.setProperty('--fx', `${(x * .6).toFixed(1)}px`); b.style.setProperty('--fy', `${(y * .6).toFixed(1)}px`); } };
