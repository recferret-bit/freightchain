/* UNDER THE HOOD cards (index.html .oc): each card's drawing becomes a small canvas scene, loaded lazily by main.js (never with reduced motion – the SVG stays).
   A scene runs a cycle of ~6 s, but every time round it rolls new numbers and timings (the km driven, a nonce, which button gets tapped, a cycle ±15 % long)
   and sprinkles events that are not on any cycle (QR cells, km ticks, checkpoints), so it never reads as a looped GIF. Logical space 240×124 = public/media/chain/*.svg,
   which stay the no-JS / reduced-motion picture. Only scenes on screen with their front face up are drawn. Not gameplay: Math.random is fine here. */
const W = 240, H = 124, PU = '#9945ff', GR = '#14f195', AM = '#ffcf5a', CR = '#e8e2cf', DI = '#9d957f', BG = '#0b0a09', LI = '#c4a2ff';
const R = Math.random, rnd = (a, b) => a + R() * (b - a), pick = a => a[Math.floor(R() * a.length)];
const cl = x => Math.min(1, Math.max(0, x)), ease = x => (x = cl(x), x * x * (3 - 2 * x)), seg = (p, a, b) => ease((p - a) / (b - a)), lerp = (a, b, k) => a + (b - a) * k;
const fade = p => 1 - seg(p, 0.93, 1);   // every cycle fades its moving parts out before the next roll
const HEX = '0123456789abcdef', B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const str = (n, abc = HEX) => Array.from({ length: n }, () => pick(abc)).join('');
/* k = share of the string still scrambled, resolving left to right; the noise changes 14× a second and each glyph keeps its own value in between (a fresh random pick every frame flickered) */
const scramble = (s, k, t) => { const step = Math.floor(t * 14); return [...s].map((ch, i) => ('….· '.includes(ch) || k <= 1 - (i + 1) / s.length ? ch : HEX[(Math.imul(i + 1, 2654435761) ^ Math.imul(step, 40503)) >>> 28])).join(''); };

let c;   // the context being drawn
const grad = (x0, x1) => { const g = c.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, PU); g.addColorStop(1, GR); return g; };
function box(x, y, w, h, r, fill, stroke, lw = 1) { c.beginPath(); c.roundRect(x, y, w, h, r); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); } }
function text(s, x, y, size, color, align = 'left', bold = false) { c.font = `${bold ? '700 ' : ''}${size}px ui-monospace,"SF Mono",Menlo,Consolas,monospace`; c.fillStyle = color; c.textAlign = align; c.fillText(s, x, y); }
function line(x0, y0, x1, y1, color, lw = 1) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.strokeStyle = color; c.lineWidth = lw; c.stroke(); }
function dot(x, y, r, color) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = color; c.fill(); }
const alpha = (a, f) => { const o = c.globalAlpha; c.globalAlpha = o * cl(a); f(); c.globalAlpha = o; };
/** a cycle of ~len s: [phase 0…1, this round's rolled values]; each round is 0.85–1.15 × len */
function cycle(len, roll) { let t0 = -1e9, d = 1, v; return t => { if (t - t0 >= d) { t0 = t; d = len * rnd(0.85, 1.15); v = roll(); } return [(t - t0) / d, v]; }; }
/** the press of a tap at phase `at`, 0…1…0 */
const press = (p, at) => seg(p, at, at + 0.03) - seg(p, at + 0.05, at + 0.1);
/** a finger that travels to (x, y) and taps at phase `at`: ring + ripple – draw it AFTER the button so it stays on top */
function finger(p, at, from, x, y) {
  const k = seg(p, at - 0.2, at), px = lerp(from[0], x, k), py = lerp(from[1], y, k), r = seg(p, at, at + 0.15);
  alpha((seg(p, at - 0.25, at - 0.15) - seg(p, at + 0.1, at + 0.2)), () => { dot(px, py, 5, '#ffffff55'); c.beginPath(); c.arc(px, py, 5, 0, 7); c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke(); });
  if (r > 0 && r < 1) alpha(1 - r, () => { c.beginPath(); c.arc(x, y, 4 + r * 26, 0, 7); c.strokeStyle = GR; c.lineWidth = 1.5; c.stroke(); });
}

export const SCENES = {
  /* 15 s batches rise from the road into the leaves, hash up the tree, the root settles on a fresh hash and turns VERIFIED */
  proof() {
    const L = [30, 90, 150, 210], cyc = cycle(6.5, () => ({ at: L.map((_, i) => 0.06 + i * 0.1 + rnd(-0.03, 0.03)), root: `${str(4)}…${str(3)}`, road: rnd(12, 26) }));
    let off = 0, last = 0;
    return t => {
      const [p, v] = cyc(t), a = fade(p); off -= (t - last) * v.road; last = t;
      c.setLineDash([6, 5]); c.lineDashOffset = off; c.beginPath(); c.moveTo(10, 118); c.bezierCurveTo(60, 104, 80, 122, 120, 112); c.bezierCurveTo(160, 102, 190, 100, 230, 116);
      c.strokeStyle = '#ffcf5a66'; c.lineWidth = 2; c.stroke(); c.setLineDash([]);
      const done = [Math.max(v.at[0], v.at[1]) + 0.05, Math.max(v.at[2], v.at[3]) + 0.05], top = Math.max(...done) + 0.1;
      L.forEach((x, i) => line(x, 84, i < 2 ? 60 : 180, 56, '#9d957f77'));
      line(60, 44, 120, 28, '#9d957f77'); line(180, 44, 120, 28, '#9d957f77');
      L.forEach((x, i) => {
        const up = seg(p, v.at[i] - 0.06, v.at[i]), lit = seg(p, v.at[i], v.at[i] + 0.04) * a;
        if (up > 0 && up < 1) alpha(a, () => dot(x, lerp(116, 100, up), 2.5, AM));
        box(x - 18, 84, 36, 18, 4, BG, '#9d957f88'); alpha(lit, () => box(x - 18, 84, 36, 18, 4, '#9945ff22', PU));
        text(`${(i + 1) * 15}s`, x, 96.5, 9, lit > 0.5 ? CR : DI, 'center');
        const q = seg(p, done[i >> 1], done[i >> 1] + 0.08);
        if (q > 0 && q < 1) alpha(a, () => dot(lerp(x, i < 2 ? 60 : 180, q), lerp(84, 56, q), 2.2, LI));
      });
      [60, 180].forEach((x, j) => {
        const lit = seg(p, done[j] + 0.08, done[j] + 0.11) * a, q = seg(p, top, top + 0.08);
        box(x - 16, 44, 32, 14, 4, BG, '#9945ffaa'); alpha(lit, () => { box(x - 16, 44, 32, 14, 4, '#9945ff55', PU); text(v.root.slice(j * 2, j * 2 + 2) + '…', x, 54, 7.5, CR, 'center'); });
        if (q > 0 && q < 1) alpha(a, () => dot(lerp(x, 120, q), lerp(44, 28, q), 2.2, GR));
      });
      const lit = seg(p, top + 0.08, top + 0.12) * a, sc = 1 - seg(p, top + 0.1, top + 0.22), ok = seg(p, top + 0.22, top + 0.27) * a;
      c.shadowColor = GR; c.shadowBlur = 12 * lit * (0.75 + 0.25 * Math.sin(t * 4));
      box(96, 8, 48, 20, 5, BG, lit > 0.05 ? grad(96, 144) : '#9d957f88', 2); c.shadowBlur = 0;
      text('ROOT', 120, 21.5, 9, lit > 0.5 ? GR : DI, 'center');
      alpha(lit, () => text(scramble(v.root, sc, t), 152, 15, 8, DI)); alpha(ok, () => text('✓ VERIFIED', 152, 26, 8, GR));
    };
  },
  /* a pledge fills km by km with 15 s checkpoints popping along it; the unspent rest slides back to the sponsor */
  pledge() {
    const x0 = 14, w = 212, k = w / 500;
    const cyc = cycle(7, () => { const km = Math.round(rnd(340, 480)); return { km, cp: Array.from({ length: 6 + Math.floor(R() * 4) }, () => rnd(10, km - 5)).sort((m, n) => m - n) }; });
    return t => {
      const [p, v] = cyc(t), a = fade(p), head = v.km * seg(p, 0.05, 0.7), back = seg(p, 0.72, 0.8);
      for (const km of [0, 100, 200, 300, 400, 500]) { line(x0 + km * k, 40, x0 + km * k, 46, '#9d957f88'); text(String(km), x0 + km * k, 36, 8, DI, 'center'); }
      text('km · 0.001 SOL each', x0 + w, 22, 8, DI, 'right');
      box(x0, 50, w, 22, 5, BG, '#9d957f55');
      alpha(a, () => {
        if (head > 1) { c.save(); c.beginPath(); c.roundRect(x0, 50, w, 22, 5); c.clip(); c.fillStyle = grad(x0, x0 + w); c.fillRect(x0, 50, head * k, 22); c.fillStyle = '#9945ff66'; c.fillRect(x0 + v.km * k, 50, (500 - v.km) * k * back, 22); c.restore(); }
        v.cp.forEach(km => { const q = cl((head - km) / 25); if (q > 0) alpha(q, () => line(x0 + km * k, 50, x0 + km * k, 54 - q * 2, '#0b0a09cc', 1.5)); });
        line(x0 + head * k, 46, x0 + head * k, 76, AM, 1.5); text(`${Math.round(head)} km`, x0 + head * k, 86, 8, AM, 'center');
        text(`${(head / 1000).toFixed(3)} → driver`, x0, 104, 9.5, GR);
        alpha(back, () => text(`${((500 - v.km) / 1000).toFixed(3)} → you`, x0 + w, 104, 9.5, LI, 'right'));
      });
    };
  },
  /* the wallet prompt: a fresh nonce decodes, a finger taps APPROVE, the nonce is burned */
  siws() {
    const cyc = cycle(6.5, () => ({ nonce: `${str(4)}…${str(2)}`, at: rnd(0.42, 0.52), from: [rnd(150, 235), rnd(8, 60)] }));
    return t => {
      const [p, v] = cyc(t), a = fade(p);
      box(40, 6, 160, 112, 10, '#120f0c', grad(40, 200), 1.5);
      c.beginPath(); c.arc(58, 22, 7, 0, 7); c.fillStyle = grad(51, 65); c.fill(); text('Sign in', 70, 25.5, 9, CR);
      text('domain', 52, 46, 8.5, DI); text('freightchain.fun', 188, 46, 8.5, CR, 'right');
      text('nonce', 52, 60, 8.5, DI); text('chain', 52, 74, 8.5, DI); text('solana', 188, 74, 8.5, CR, 'right');
      const n = `${scramble(v.nonce, 1 - seg(p, 0.05, 0.25), t)} · once`; text(n, 188, 60, 8.5, AM, 'right');
      const burn = seg(p, v.at + 0.15, v.at + 0.25) * a; if (burn > 0) { const wn = c.measureText(n).width; line(188 - wn, 57, 188 - wn + wn * burn, 57, '#ffcf5acc', 1); }
      const pr = press(p, v.at), done = seg(p, v.at + 0.08, v.at + 0.14) * a, sc = 1 - 0.05 * pr;
      c.save(); c.translate(120, 97); c.scale(sc, sc); box(-68, -11, 136, 22, 11, grad(-68, 68));
      alpha(1 - done, () => text('APPROVE', 0, 3.5, 9.5, BG, 'center', true)); alpha(done, () => text('✓ SIGNED IN', 0, 3.5, 9.5, BG, 'center', true)); c.restore();
      finger(p, v.at, v.from, 120, 97);
    };
  },
  /* a live board: km tick up at random, rows swap places, and each round one wallet is looked up – mostly a .sol name, sometimes none */
  sns() {
    const NAMES = ['driver.sol', 'nightowl.sol', 'longhaul.sol', 'gearbox.sol', 'route66.sol', 'dieselcat.sol', 'coldstart.sol', 'redline.sol'];
    const rows = [{ n: 'driver.sol', km: 412 }, { n: 'nightowl.sol', km: 398 }, { n: null, a: '7xKX…9fQd', km: 377 }].map((r, i) => ({ ...r, y: 14 + i * 30 }));
    const cyc = cycle(6, () => { const r = pick(rows), free = NAMES.filter(x => !rows.some(o => o.n === x)); r.n = null; r.a = `${str(4, B58)}…${str(4, B58)}`; r.next = R() < 0.8 ? pick(free) : null; return { r }; });
    let last = 0;
    return t => {
      const [p, v] = cyc(t), dt = Math.min(0.1, t - last); last = t;
      for (const r of rows) if (R() < dt * 0.9) r.km += 1;
      if (Math.min(...rows.map(r => r.km)) > 900) rows.forEach(r => (r.km -= 500));
      const order = [...rows].sort((m, n) => n.km - m.km);
      order.forEach((r, i) => { r.y = lerp(r.y, 14 + i * 30, Math.min(1, dt * 6)); });
      const look = seg(p, 0.3, 0.5); if (look >= 1 && v.r.next) { v.r.n = v.r.next; v.r.next = null; }
      order.forEach((r, i) => {
        box(10, r.y, 220, 24, 5, i ? BG : '#9945ff1a', i ? '#9d957f33' : grad(10, 230)); text(String(i + 1), 22, r.y + 16, 10, AM);
        const resolving = r === v.r && v.r.next && look > 0;
        text(r.n ?? (resolving ? scramble(r.a, look, t) : r.a), 40, r.y + 16, 10.5, r.n ? GR : resolving ? LI : DI); text(`${r.km} km`, 220, r.y + 16, 10, CR, 'right');
      });
      const none = !v.r.n && !v.r.next ? seg(p, 0.45, 0.55) * fade(p) : 0;   // this round's lookup found no name
      text('no name? the short address stays', 10, 114, 8, DI); alpha(none, () => text('no name? the short address stays', 10, 114, 8, AM));
    };
  },
  /* a post on X (a Blink): a finger taps BUY TICKET or WATCH; beside it the stream's Solana Pay QR twinkles, and now and then a phone scans it and a tip lands */
  blink() {
    const qr = Array.from({ length: 81 }, (_, i) => { const x = i % 9, y = (i / 9) | 0, f = (x < 3 && y < 3) || (x > 5 && y < 3) || (x < 3 && y > 5); return f ? 2 : +(R() < 0.4); });
    const cyc = cycle(5.5, () => ({ watch: R() < 0.35, amt: rnd(0.005, 0.02).toFixed(3), at: rnd(0.25, 0.35), from: [rnd(60, 150), rnd(2, 30)], scan: rnd(0.45, 0.75) }));
    let last = 0;
    return t => {
      const [p, v] = cyc(t), a = fade(p), dt = Math.min(0.1, t - last); last = t;
      if (R() < dt * 5) { const i = Math.floor(R() * 81); if (qr[i] < 2) qr[i] ^= 1; }
      box(8, 10, 140, 104, 9, BG, '#9d957f55'); dot(22, 24, 6, AM); box(33, 20, 60, 4, 2, '#9d957f88'); box(33, 27, 36, 3, 1.5, '#9d957f55');
      box(16, 38, 124, 34, 5, '#26221d');
      const toast = seg(p, v.at + 0.1, v.at + 0.15) * (1 - seg(p, 0.8, 0.88)) * a;   // the wallet's confirmation replaces the card's title for a moment
      alpha(1 - toast, () => text('FREIGHT CHAIN · 1 h', 78, 59, 8.5, AM, 'center'));
      const pr = press(p, v.at), sc = 1 - 0.06 * pr;
      c.save(); c.translate(52, 88); if (!v.watch) c.scale(sc, sc); box(-36, -10, 72, 20, 10, grad(-36, 36)); text('BUY TICKET', 0, 3.5, 8.5, BG, 'center', true); c.restore();
      c.save(); c.translate(117, 88); if (v.watch) c.scale(sc, sc); box(-23, -10, 46, 20, 10, v.watch && pr > 0 ? '#9945ff33' : null, PU); text('WATCH', 0, 3.5, 8.5, LI, 'center'); c.restore();
      finger(p, v.at, v.from, v.watch ? 117 : 52, 88);
      alpha(toast, () => { box(20, 44 - toast * 3, 116, 22, 5, '#0b0a09ee', GR); text(v.watch ? '▶ live ride opened' : '✓ ticket · 1 h', 78, 58.5 - toast * 3, 8.5, GR, 'center'); });
      box(158, 20, 75, 75, 6, BG, '#9d957f55');
      qr.forEach((on, i) => { if (on) box(164 + (i % 9) * 7, 26 + ((i / 9) | 0) * 7, 6, 6, 0, on === 2 ? CR : GR); });
      const q = seg(p, v.scan, v.scan + 0.14);
      if (q > 0 && q < 1) { c.shadowColor = GR; c.shadowBlur = 8; line(161, 26 + q * 63, 230, 26 + q * 63, '#14f195cc', 1.5); c.shadowBlur = 0; }
      const tip = seg(p, v.scan + 0.14, v.scan + 0.3); if (tip > 0 && tip < 1) alpha(1 - tip, () => text(`+${v.amt} SOL tip`, 195, 22 - tip * 8, 8, GR, 'center'));
      text('tip · Solana Pay', 195, 110, 8, DI, 'center');
    };
  },
};

/** one frame of a scene (`draw` = SCENES[k]()) at t s on a context scaled k × the 240×124 design; exported for the tests' fake context */
export function drawScene(ctx, draw, t, k = 1) { c = ctx; c.setTransform(k, 0, 0, k, 0, 0); c.clearRect(0, 0, W, H); c.globalAlpha = 1; draw(t); }

/** swap each card's drawing for its scene and run one rAF loop for all of them */
export function startChainScenes(cards) {
  const live = [];
  for (const card of cards) {
    const img = card.querySelector('.stage img'), make = SCENES[card.dataset.card];
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    if (!make || !ctx?.roundRect) continue;   // an old browser without roundRect keeps the SVG
    cv.width = W * 2; cv.height = H * 2; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', img.alt); img.replaceWith(cv);
    live.push({ card, cv, ctx, draw: make(), on: false });
  }
  const turned = matchMedia('(hover:hover)').matches ? '.flip,:hover,:focus-within' : '.flip,:focus-within';   // a phone keeps :hover on the last tapped card – it would freeze once flipped back
  const faceUp = s => s.on && !s.card.matches(turned);
  let raf = 0;
  const frame = ms => {
    raf = 0;
    if (document.hidden) return;
    let drew = false;
    for (const s of live) {
      if (!faceUp(s)) continue;   // off screen or turned over: nothing to see
      drew = true;
      const w = Math.round(s.cv.clientWidth * Math.min(3, devicePixelRatio || 1));
      if (w && s.cv.width !== w) { s.cv.width = w; s.cv.height = Math.round((w * H) / W); }
      drawScene(s.ctx, s.draw, ms / 1000, s.cv.width / W);
    }
    if (drew) raf = requestAnimationFrame(frame);   // no face-up card on screen: the loop stops
  };
  const kick = () => { if (!raf && !document.hidden && live.some(faceUp)) raf = requestAnimationFrame(frame); };
  const io = new IntersectionObserver(es => { for (const e of es) live.find(s => s.cv === e.target).on = e.isIntersecting; kick(); });
  live.forEach(s => {
    io.observe(s.cv);
    for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout', 'click']) s.card.addEventListener(type, kick);
  });
  document.addEventListener('visibilitychange', kick);
  kick();
}
