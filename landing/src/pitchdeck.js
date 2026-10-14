/* Freight Chain pitch deck (pitchdeck.<apex>, landing/pitchdeck.html – the "Poster" theme, src/pitchdeck.css). Makes NO request of its own: every file is the landing build's.
   The slides are author-written constants, so they go in with innerHTML (the landing's no-innerHTML rule is for server text; this file takes none).
   Keys: → / space next · ← back · F fullscreen · Home / End.
   Every number on the traction slide is PostHog EU, Oct 8–12 2026, distinct people (see DATA). */

const A = '/media/pitchdeck/', BADGES = '/badges/';   // absolute: on pitchdeck.<apex> a relative path would resolve against the host's /
const shot = (src, cls = '', alt = '') => `<figure class="shot ${cls}"><img src="${A}${src}" alt="${alt}" loading="eager"></figure>`;
const clip = (src, cls = '') => `<figure class="shot clip ${cls}"><video src="${A}${src}" muted playsinline loop preload="auto"></video></figure>`;   // promo-clip.mp4 = the promo's 16–24 s, cut once
const pts = items => `<ul class="pts">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;

/* PostHog EU project 297915, queried Oct 12 2026 23:10 UTC. Distinct person ids.
   Server-side player_signed_in (51 new ids, 2 of them ever saw the landing) are the deploy smoke test's throwaway wallets – left out. */
const DATA = {
  funnel: [
    ['Visited the landing', 104],
    ['Started the film', 49],
    ['Scrolled past the hero', 13],
    ['Clicked play', 9],
    ['Clicked connect wallet', 4],
  ],
  daily: [['Oct 8', 27], ['Oct 9', 24], ['Oct 10', 22], ['Oct 11', 19], ['Oct 12', 20]],
  source: 'PostHog EU · Oct 8–12 2026 · distinct visitors · test wallets excluded',
};

const SLIDES = [
  { layout: 'wall', id: 'product',
    html: `
      <div class="copy">
        <div class="brand"><img src="/icons/icon-192.png" alt=""><span>FREIGHT CHAIN</span></div>
        <div class="lbl">00 · The product</div>
        <h1>Freight Chain<small>Competitive · GameFi</small></h1>
        ${pts(['<b>Site</b> · landing, lobby, whitepaper', '<b>Streams</b> · live watch + replays', '<b>Analytics</b> · PostHog funnels', '<b>Solana</b> · devnet escrow, no token', '<b>Details</b> · gearbox, cold engine, night', '<b>Passion</b> · built solo, shipped fast'])}
      </div>
      <div class="vis">
        ${shot('landing-hero.webp', 'w1', 'The landing')}
        ${shot('watch-replay.webp', 'w2', 'Watching a replay')}
        ${shot('wp-onchain.webp', 'w3', 'Whitepaper, on-chain chapter')}
        ${shot('receipt-card.webp', 'w4', 'A public ride receipt')}
        <div class="tags"><span>SITE</span><span>STREAMS</span><span>ANALYTICS</span><span>SOLANA ESCROW</span></div>
      </div>` },

  { layout: 'bleed', id: 'game',
    html: `
      <video class="bg" src="/media/hero-preview.mp4" poster="/media/hero-poster.webp" muted playsinline loop preload="auto"></video>
      <div class="shade"></div>
      <div class="copy">
        <div class="lbl">01 · The game</div>
        <h1>The road never ends.<br><em>Your shift does.</em></h1>
        ${pts(['<b>Gearbox</b> · manual, clutch, stalls', '<b>Engine</b> · cold starts, heat, battery', '<b>Road</b> · endless, day and night', '<b>Traffic</b> · forks, bends, sinkholes', '<b>Speed</b> · capped near 100 km/h'])}
      </div>
      <div class="vis">${shot('01-one-mistake.webp', 'poster', 'One mistake ends the shift')}</div>` },

  { layout: 'split', id: 'insight',
    html: `
      <div class="copy">
        <div class="lbl">02 · The insight</div>
        <h1>The game<br>is the door.</h1>
        ${pts(['Native streams and replays', 'Donations and chat', 'Web2 friendly', "I'm chasing Web3 adoption a lot", '<b>The stream is the ad</b>'])}
      </div>
      <div class="vis">
        ${clip('promo-clip.mp4', 'v-main')}
        <div class="badge live"><i class="dot"></i>LIVE · NO WALLET TO WATCH</div>
      </div>` },

  { layout: 'split flip', id: 'play',
    html: `
      <div class="copy">
        <div class="lbl">03 · Play</div>
        <h1>Free<br>tonight.</h1>
        ${pts(['10 free rides · no download', 'Watch live or replay · no wallet', 'Paid: 1 h seat · a few $ in SOL', 'One signature'])}
        <ol class="ladder">
          <li class="on"><b>FREE</b><span>3 min</span></li>
          <li class="on"><b>1 H</b><span>devnet pool</span></li>
          <li><b>4 H</b><span>next</span></li>
          <li><b>8 H</b><span>next</span></li>
        </ol>
      </div>
      <div class="vis">
        ${shot('game-guest.webp', 'v-main', 'Free run in the cab')}
        ${shot('receipt-card.webp', 'v-sub receipt', 'Ride receipt')}
      </div>` },

  { layout: 'money', id: 'money',
    html: `
      <div class="copy">
        <div class="lbl">04 · The money</div>
        <h1>The program<br>holds the money.</h1>
        <div class="split" role="group" aria-label="70 percent to finishers, 20 percent to the next pool, 10 percent fee">
          <div style="--w:70"><b>70%</b><i class="desc">Of every pool: paid to finishers, ranked by distance</i><span>finishers · by distance</span></div>
          <div style="--w:20"><b>20%</b><i class="desc">Of every pool: seeds the next pool</i><span>next pool</span></div>
          <div style="--w:10"><b>10%</b><i class="desc">Of every pool: the platform fee</i><span>fee</span></div>
        </div>
        ${pts(['Too few tickets · refund, without me', 'Road seed committed on chain', 'Pays only attested rides'])}
        <div class="fine">DEVNET · NOT AUDITED · NO TOKEN</div>
      </div>
      <div class="vis">
        ${shot('wp-diagram.webp', 'v-main diagram', 'Where the money goes')}
        ${shot('escrow-flow.webp', 'v-sub', 'How the escrow works')}
        <canvas class="glyph g1" data-scene="proof" role="img" aria-label="Four 15-second batches hash up into one Merkle root, which turns verified"></canvas>
        <div class="vblock" aria-hidden="true">✓ Attestation<small>PDA gated · pays only verified rides</small></div>
      </div>` },

  { layout: 'chart', id: 'traction',
    html: `
      <div class="copy">
        <div class="lbl">05 · Traction</div>
        <h1>104 visitors · 5 days</h1>
      </div>
      <div class="stats">
        <div><b>1 in 2</b><span>start the film</span></div>
        <div><b>9 in 10</b><span>never scroll past the hero</span></div>
        <div class="hot"><b>4</b><span>reached connect wallet · <em>next number</em></span></div>
      </div>
      <div class="charts">
        <section><h3>Landing funnel · people</h3><div class="chart" data-chart="funnel"></div></section>
        <section><h3>Visitors per day</h3><div class="chart" data-chart="daily"></div></section>
      </div>
      <div class="src">${DATA.source}</div>` },

  { layout: 'end', id: 'next',
    html: `
      <div class="copy">
        <div class="lbl">06 · Next</div>
        <h1>Solana<br>Ecosystem track</h1>
        <ol class="road">
          <li><b>01</b>Community and polishing</li>
          <li><b>02</b>Audit</li>
          <li><b>03</b>Mainnet</li>
          <li><b>04</b>Game modes and modding</li>
        </ol>
      </div>
      <div class="vis">
        ${shot('landing-roadmap.webp', 'v-main', 'Roadmap trip sheet')}
        <div class="badges">${['shift-complete-4', 'night-owl-4', 'century-4', 'clean-run-4', 'cold-start-4', 'first-mile-4'].map(b => `<img src="${BADGES}${b}.svg" alt="">`).join('')}</div>
      </div>` },

  { layout: 'end gtm', id: 'market',
    html: `
      <div class="copy">
        <div class="lbl">07 · Go to market</div>
        <h1>Go to<br>market</h1>
        <ol class="road">
          <li><b>01</b>Community and polishing</li>
          <li><b>02</b>Funded marketing rides</li>
          <li><b>03</b>Streamers collaboration</li>
          <li><b>04</b>10% fees</li>
          <li><b>05</b>No token</li>
        </ol>
      </div>
      <div class="vis">
        ${shot('landing-market.webp', 'v-main', 'Go to market load board')}
      </div>` },
];

/* ── charts (SVG, single hue per chart: magnitude, not identity) ── */
const svgEl = (tag, attrs, text) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };

function funnel(el) {
  const W = 820, rowH = 62, H = DATA.funnel.length * rowH, labW = 330, valW = 130, max = DATA.funnel[0][1];
  const s = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMinYMid meet', role: 'img', 'aria-label': DATA.funnel.map(([k, v]) => `${k} ${v}`).join(', ') });
  DATA.funnel.forEach(([k, v], i) => {
    const y = i * rowH, bw = Math.max(6, (W - labW - valW) * v / max);
    s.append(svgEl('text', { x: 0, y: y + rowH / 2 + 7, class: 'c-lab' }, k));
    s.append(svgEl('rect', { x: labW, y: y + 12, width: W - labW - valW, height: rowH - 24, rx: 4, class: 'c-track' }));
    const r = svgEl('rect', { x: labW, y: y + 12, width: bw, height: rowH - 24, rx: 4, class: 'c-bar', 'data-tip': `${k}: ${v} people · ${Math.round(100 * v / max)}% of visitors` });
    s.append(r);
    s.append(svgEl('text', { x: labW + bw + 12, y: y + rowH / 2 + 8, class: 'c-val' }, String(v)));
    if (i) s.append(svgEl('text', { x: W, y: y + rowH / 2 + 8, class: 'c-pct', 'text-anchor': 'end' }, `${Math.round(100 * v / max)}%`));
  });
  el.append(s);
}

function daily(el) {
  const W = 560, H = 310, base = 260, top = 40, max = 30, n = DATA.daily.length, gap = 26, bw = (W - gap * (n - 1)) / n;
  const s = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': DATA.daily.map(([d, v]) => `${d}: ${v}`).join(', ') });
  s.append(svgEl('line', { x1: 0, x2: W, y1: base, y2: base, class: 'c-axis' }));
  DATA.daily.forEach(([d, v], i) => {
    const x = i * (bw + gap), h = (base - top) * v / max;
    s.append(svgEl('path', { d: `M${x},${base} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z`, class: 'c-bar', 'data-tip': `${d}: ${v} visitors` }));
    s.append(svgEl('text', { x: x + bw / 2, y: base - h - 12, class: 'c-val', 'text-anchor': 'middle' }, String(v)));
    s.append(svgEl('text', { x: x + bw / 2, y: base + 36, class: 'c-lab', 'text-anchor': 'middle' }, d));
  });
  el.append(s);
}

/* ── header ticker: the landing's running text (LCD green on black) – project facts, and real lines from the code (client/shared/physics.js, road.js, prng.js, js/config.js, the Anchor program) ── */
const FACTS = [
  'One endless road · one shift', 'Browser game after Desert Bus', 'Manual 7-speed gearbox · clutch · stalls', 'Cold engine · heat · battery', 'Traffic · forks · sinkholes', 'Day and night',
  'Speed capped near 100 km/h', 'Parking brake · handbrake starts', 'Wipers · windscreen dust · wash', 'CB radio · eleven stations', 'Dice on the mirror',
  'Gauges: oil · air · fuel · volts · H2O · temp', 'Lamps: STALL · COLD · OFF ROAD · STRAIN · OVER-REV · GRIND', 'Headlights · cab lamp · heat', 'Engine off at the start: turn the key',
  '10 free rides · no download · in your browser', 'Three free levels: easy · medium · hard', 'Five routes', 'Live watch and replays · no wallet to watch', '31 achievement badges',
  ['code', 'GEAR_RATIOS = [0, 6.15, 4.33, 3.05, 2.15, 1.51, 1.065, 0.75]'],
  ['code', 'thrust = (TRUCK_POWER / TRUCK_MASS) * ratio ** TRUCK_GEAR_EXP * gas'],
  ['code', 'drag = ROLL_RES + (DRAG / MASS) * v * v + offroad * 1.2 + brake * 5.5'],
  ['code', 'v = max(0, min(HOLE_REF_SPEED, v + (thrust - drag) * h))'],
  'Physics at 10 Hz · 2 substeps · the server re-runs every ride',
  ['code', 'TRUCK_MASS = 2.5 · TRUCK_POWER = 2.4 · TRUCK_BRAKE = 5.5'],
  ['code', 'TORQUE_PEAK = 2000 rpm · SHIFT_TIME = 0.4 s'],
  ['code', 'HOLE_CHANCE = 0.045 · HOLE_FIRST = 150 · OFFROAD_FAIL_SECONDS = 20'],
  ['code', 's = (s + 0x6D2B79F5) | 0   // mulberry32: the same road in your browser and on the server'],
  'Vanilla ES modules · three.js r160 · no build step · no framework', 'NestJS · Prisma · PostgreSQL', 'Prize pool split 70 / 20 / 10',
  'Solana devnet · no token · not audited', ['code', 'program id 8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p'], 'Anchor program · 14 instructions · 12 events · 24 errors',
  'Built solo in Belgrade'];
const tk = document.querySelector('#ticker .tk');
const tkItems = () => FACTS.map(f => { const e = document.createElement('span'), [kind, text] = Array.isArray(f) ? f : ['', f]; e.textContent = text; if (kind) e.className = kind; return e; });
tk.append(...tkItems(), ...tkItems());   // doubled: the -50% translate loops seamlessly
/* the ticker is driven by script, not CSS: ~190 px/s (stage px), easing down to a crawl while the pointer is over it and for a moment after a click / tap, then easing back up */
const TK_FAST = 190, TK_SLOW = 24, tkReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let tkX = 0, tkV = TK_FAST, tkHold = 0, tkOver = false, tkLast = 0;
const tkEl = document.getElementById('ticker');
tkEl.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') tkOver = true; });
tkEl.addEventListener('pointerleave', () => { tkOver = false; });
function tkTick(t) {
  const dt = Math.min(.1, (t - tkLast) / 1000) || 0; tkLast = t;
  const target = tkReduced ? 0 : (tkOver || t < tkHold) ? TK_SLOW : TK_FAST;
  tkV += (target - tkV) * (1 - Math.exp(-dt * 3.5));   // an exponential tween: ~0.3 s to most of the way either direction
  tkX = (tkX + tkV * dt) % (tk.scrollWidth / 2);   // the list is doubled, so half its width is one seamless loop
  tk.style.transform = `translateX(${-tkX.toFixed(1)}px)`;
  requestAnimationFrame(tkTick);
}
requestAnimationFrame(tkTick);

/* ── engine ── */
const deck = document.getElementById('deck');
deck.innerHTML = SLIDES.map((s, i) => `<section class="slide L-${s.layout.split(' ').join(' L-')}" id="s-${s.id}" data-i="${i}">${s.html}</section>`).join('');
deck.querySelectorAll('[data-chart=funnel]').forEach(funnel);
deck.querySelectorAll('[data-chart=daily]').forEach(daily);

const slides = [...deck.children];

/* live canvas scenes lifted from the landing's UNDER THE HOOD cards (src/chain-scenes.js – a lazy chunk the landing shares), drawn straight onto the slide with no card around them, only while their slide is showing */
const scenes = [...deck.querySelectorAll('canvas[data-scene]')].map(cv => ({ cv, ctx: cv.getContext('2d'), slide: cv.closest('.slide'), name: cv.dataset.scene, draw: null }));
let sceneLib = null;
(window.requestIdleCallback ?? (f => setTimeout(f, 800)))(() => import('./chain-scenes.js').then(m => {
  sceneLib = m;
  scenes.forEach(sc => { if (sc.ctx?.roundRect) sc.draw = m.SCENES[sc.name]?.(); });   // no roundRect (an old browser): the card keeps its caption and an empty frame
}).catch(() => {}));
function sceneFrame(ms) {
  if (sceneLib) for (const sc of scenes) {
    if (!sc.draw || !sc.slide.classList.contains('on')) continue;
    const w = Math.round(sc.cv.clientWidth * 2);   // 2× the layout width, so the stage's scaling stays sharp
    if (w && sc.cv.width !== w) { sc.cv.width = w; sc.cv.height = Math.round(w * 124 / 240); }
    sceneLib.drawScene(sc.ctx, sc.draw, tkReduced ? 3.2 : ms / 1000, sc.cv.width / 240);
  }
  requestAnimationFrame(sceneFrame);
}
requestAnimationFrame(sceneFrame);

/* page counter: an old mechanical-watch roll – the digit that changes rolls out and the new one rolls in (up going forward, down going back) while the counter swells 1.05 for a beat */
const pager = document.getElementById('pager');
const mkDigit = () => { const dg = document.createElement('span'), col = document.createElement('span'); dg.className = 'dg'; col.className = 'col'; dg.append(col); return dg; };
const dgs = [mkDigit(), mkDigit()], of = document.createElement('span');
of.className = 'of'; of.textContent = ` / ${String(slides.length).padStart(2, '0')}`;
pager.append(...dgs, of);
const cell = ch => { const e = document.createElement('span'); e.textContent = ch; return e; };
function setPager(i, from) {   // from = the previous slide, -1 on load
  const txt = String(i + 1).padStart(2, '0');
  dgs.forEach((dg, k) => {
    const col = dg.firstElementChild, old = col.dataset.v;
    if (old === txt[k]) return;
    col.dataset.v = txt[k];
    if (from < 0 || tkReduced || old == null) { col.replaceChildren(cell(txt[k])); col.style.transform = ''; return; }
    const fwd = i > from;
    col.style.transition = 'none';
    col.replaceChildren(...(fwd ? [cell(old), cell(txt[k])] : [cell(txt[k]), cell(old)]));
    col.style.transform = fwd ? 'translateY(0)' : 'translateY(-50%)';
    void col.offsetWidth;
    col.style.transition = 'transform .55s cubic-bezier(.2,.8,.2,1)';
    col.style.transform = fwd ? 'translateY(-50%)' : 'translateY(0)';
  });
  if (from >= 0 && !tkReduced) { pager.classList.remove('tick'); void pager.offsetWidth; pager.classList.add('tick'); }
}
const stage = document.getElementById('stage');
let scale = 1;   // stage px → screen px
const fit = () => {
  const k = scale = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(-50%,0) scale(${k})`;
  tkEl.style.transform = `scale(${k})`; tkEl.style.width = `${innerWidth / k}px`;   // the header hugs the top edge of the window, full width, whatever the letterboxing
};
addEventListener('resize', fit); fit();

let cur = -1;
function show(i) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  if (i === cur) return;
  slides.forEach((s, j) => s.classList.toggle('on', j === i));
  slides.forEach((s, j) => s.querySelectorAll('video').forEach(v => { if (j === i) start(v); else v.pause(); }));
  setPager(i, cur);
  cur = i;
  history.replaceState(null, '', '#' + (i + 1));
  document.getElementById('bar').style.width = `${100 * (i + 1) / slides.length}%`;
}
const start = v => v.play().catch(() => {});

/* the 70 / 20 / 10 bar – hover (or tap) a block: the others fade out one after another (nearest first), the block slides to the left edge and grows to the full width, then its % is swapped for what it means; moving the pointer away (or tapping again) plays it backwards */
const split = deck.querySelector('.split');
if (split) {
  const blocks = [...split.children];
  let open = -1, timers = [], intent = 0;
  const later = (ms, f) => timers.push(setTimeout(f, ms));
  const expand = i => {
    timers.forEach(clearTimeout); timers = []; open = i;
    // every other block runs to the bar's border on ITS side of the picked one (left of it → the left border, right of it → the right one) and squeezes into it;
    // the farthest from the picked block goes first, equally far ones (hover 20: 70 and 10) go together; coming back it is nearest first
    const bar = split.offsetLeft, far = Math.max(...blocks.map((_, k) => Math.abs(k - i)));
    blocks.forEach((b, k) => {
      const d = Math.abs(k - i), left = b.offsetLeft - bar;
      b.classList.toggle('pick', k === i);
      b.style.setProperty('--o', d ? far - d : 0); b.style.setProperty('--r', d ? d - 1 : 0);
      b.style.setProperty('--ox', k < i ? '0%' : '100%');   // it squeezes towards the border it runs to
      b.style.setProperty('--tx', `${k < i ? -left : split.offsetWidth - left - b.offsetWidth}px`);
    });
    if (tkReduced) { split.classList.add('s-out', 's-grow', 's-text'); return; }
    split.classList.add('s-out');
    later(660, () => split.classList.add('s-grow'));
    later(1330, () => split.classList.add('s-text'));
  };
  const collapse = () => {
    timers.forEach(clearTimeout); timers = []; open = -1;
    if (tkReduced) { split.classList.remove('s-text', 's-grow', 's-out'); blocks.forEach(b => b.classList.remove('pick')); return; }
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
  split.addEventListener('click', e => {   // a tap: open the block, or close again (a mouse is already driven by hover)
    const i = blocks.indexOf(e.target.closest('.split > div'));
    if (open >= 0) { if (e.pointerType !== 'mouse') collapse(); } else if (i >= 0) expand(i);
  });
}

/* the tip flashes once per ← / → / space key press (not for a click, a tap or a hash change); the arrow in the pressed direction flashes too, space leaves both arrows alone */
function flashTip(dir) {
  const help = document.getElementById('help');
  help.classList.remove('flash', 'go-l', 'go-r'); void help.offsetWidth;
  help.classList.add('flash');
  if (dir) help.classList.add(dir);   // space flashes the tip but leaves the arrows alone
}
addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') flashTip('go-r'); else if (e.key === 'ArrowLeft') flashTip('go-l'); else if (e.key === ' ') flashTip('');
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(cur + 1); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key)) show(cur - 1);
  else if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
  else if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
});
/* the cards of slides 0–4 (.fx) and slide 0's tags: the mouse nudges them (parallax), a tap / click lifts one (.hot) instead of turning the page */
['product', 'game', 'insight', 'play', 'money'].forEach(id => document.getElementById(`s-${id}`)?.classList.add('fx'));
const fxVis = [...deck.querySelectorAll('.fx .vis')];
const setTilt = (v, px, py) => { v.style.setProperty('--px', px); v.style.setProperty('--py', py); };
fxVis.forEach(v => {
  v.parentElement.addEventListener('pointermove', e => setTilt(v, (e.clientX / innerWidth - .5).toFixed(3), (e.clientY / innerHeight - .5).toFixed(3)));
  v.parentElement.addEventListener('pointerleave', () => setTilt(v, 0, 0));
});
/* dragging a screen: it follows the pointer at about half the distance, trailing behind (a slow lerp), and eases home when let go */
const drags = new Map(); let raf = 0, moved = false;
function trail() {
  let busy = false;
  drags.forEach((d, c) => {
    d.x += (d.tx - d.x) * .06; d.y += (d.ty - d.y) * .06;
    c.style.setProperty('--dx', `${d.x.toFixed(1)}px`); c.style.setProperty('--dy', `${d.y.toFixed(1)}px`);
    const b = c.closest('.vis').querySelector('.badge');   // the LIVE badge tags along, a bit
    if (b) { b.style.setProperty('--fx', `${(d.x * .6).toFixed(1)}px`); b.style.setProperty('--fy', `${(d.y * .6).toFixed(1)}px`); }
    if (!d.down && Math.abs(d.x) < .3 && Math.abs(d.y) < .3) { c.classList.remove('drag'); c.style.removeProperty('--dx'); c.style.removeProperty('--dy'); const b = c.closest('.vis').querySelector('.badge'); b?.style.removeProperty('--fx'); b?.style.removeProperty('--fy'); drags.delete(c); } else busy = true;
  });
  raf = busy ? requestAnimationFrame(trail) : 0;
}
deck.querySelectorAll('.fx .shot').forEach(c => {
  c.addEventListener('pointerdown', e => {
    if (e.button) return;
    try { c.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    moved = false; c.classList.add('drag');
    drags.set(c, { x0: e.clientX, y0: e.clientY, x: drags.get(c)?.x ?? 0, y: drags.get(c)?.y ?? 0, tx: 0, ty: 0, down: true });
    raf ||= requestAnimationFrame(trail);
  });
  c.addEventListener('pointermove', e => {
    const d = drags.get(c); if (!d?.down) return;
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) moved = true;
    d.tx = Math.max(-150, Math.min(150, (e.clientX - d.x0) / scale * .5)); d.ty = Math.max(-110, Math.min(110, (e.clientY - d.y0) / scale * .5));
  });
  const end = () => { const d = drags.get(c); if (d) { d.down = false; d.tx = d.ty = 0; raf ||= requestAnimationFrame(trail); } };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
});

/* the LIVE badge runs from the mouse: up to ~80 stage px within ~350 px of it, rightwards capped at 32 (the stage edge) */
const badge = document.querySelector('.fx .badge'), bd = { x: 0, y: 0 };
let mouse = null;
addEventListener('pointermove', e => { mouse = e.pointerType === 'touch' ? null : [e.clientX, e.clientY]; });
document.documentElement.addEventListener('pointerleave', () => { mouse = null; });
function badgeTick() {
  let tx = 0, ty = 0;
  if (badge && mouse && badge.closest('.slide.on')) {
    const r = badge.getBoundingClientRect(), R = 352 * scale;
    const dx = r.left + r.width / 2 - bd.x * scale - mouse[0], dy = r.top + r.height / 2 - bd.y * scale - mouse[1], dist = Math.hypot(dx, dy) || 1;   // from the resting centre
    if (dist < R) { const push = 80 * (1 - dist / R) ** 1.2; tx = Math.min(32, dx / dist * push); ty = dy / dist * push; }   // rightwards is capped: the stage edge is just there
  }
  bd.x += (tx - bd.x) * .14; bd.y += (ty - bd.y) * .14;
  badge?.style.setProperty('--bx', `${bd.x.toFixed(1)}px`); badge?.style.setProperty('--by', `${bd.y.toFixed(1)}px`);
  requestAnimationFrame(badgeTick);
}
if (badge) requestAnimationFrame(badgeTick);

addEventListener('pointerdown', e => { if (!e.target.closest('.fx .shot')) moved = false; }, true);   // a drag that ended off a card must not swallow the next click
addEventListener('click', e => {
  if (e.target.closest('.split')) return;   // the bar's own click handler (a tap opens / closes a block)
  if (e.target.closest('#ticker')) { tkHold = performance.now() + 1400; return; }   // a click on the header slows it for a moment instead of turning the page
  const card = e.target.closest('.fx .shot, .fx .badge, .fx canvas.glyph, .L-wall .tags span');
  if (card) {
    if (moved) { moved = false; return; }   // the end of a drag is not a tap
    if (card.classList.contains('badge')) { card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop'); }   // a tween bump on every click
    const on = card.classList.toggle('hot'); card.closest('.vis').querySelectorAll('.hot').forEach(c => { if (c !== card && on) c.classList.remove('hot'); });
    return;
  }
  if (e.target.closest('a,button')) return;
  show(cur + (e.clientX > innerWidth / 3 ? 1 : -1));
});

/* phones: a swipe turns the page, the tip says "swipe", a portrait screen is asked to turn sideways, and the gyro tilts the screens */
const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
document.body.classList.toggle('touch', touch);
let sx = 0, sy = 0, swipe = false;
addEventListener('touchstart', e => { swipe = !e.target.closest('.fx .shot'); sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
addEventListener('touchend', e => {
  if (!swipe) return;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { flashTip(dx < 0 ? 'go-r' : 'go-l'); show(cur + (dx < 0 ? 1 : -1)); }
}, { passive: true });

const turn = document.getElementById('turn'), portrait = matchMedia('(orientation: portrait) and (max-width: 900px)');
let skipTurn = false;
const askTurn = () => { turn.hidden = !(portrait.matches && !skipTurn); };
portrait.addEventListener('change', askTurn); document.getElementById('turn-skip').addEventListener('click', () => { skipTurn = true; askTurn(); }); askTurn();

/* tilt: the phone's gyro drives the same --px / --py as the mouse (zeroed on the first reading and whenever the screen turns); iOS asks for permission on the first tap */
let base = null;
const onTilt = e => {
  if (e.gamma == null || e.beta == null || !fxVis.length) return;
  const a = ((window.screen.orientation?.angle ?? 0) + 360) % 360;
  const [x, y] = a === 90 ? [e.beta, -e.gamma] : a === 270 ? [-e.beta, e.gamma] : a === 180 ? [-e.gamma, -e.beta] : [e.gamma, e.beta];
  base ??= [x, y];
  const f = v => Math.max(-.5, Math.min(.5, v / 40)).toFixed(3);
  fxVis.forEach(v => setTilt(v, f(x - base[0]), f(y - base[1])));
};
const listenTilt = () => { addEventListener('deviceorientation', onTilt); window.screen.orientation?.addEventListener('change', () => { base = null; }); };
if (touch && window.DeviceOrientationEvent) {
  if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
    addEventListener('click', () => window.DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') listenTilt(); }).catch(() => {}), { once: true });
  } else listenTilt();
}

const tip = document.getElementById('tip');
addEventListener('mousemove', e => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  tip.hidden = false; tip.textContent = t.dataset.tip; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px';
});

const fromHash = () => show((parseInt(location.hash.slice(1), 10) || 1) - 1);
addEventListener('hashchange', fromHash);
fromHash();
