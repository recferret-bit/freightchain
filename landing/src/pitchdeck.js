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
  { layout: 'wall', id: 'driver',
    html: `
      <div class="copy">
        <div class="brand"><img src="/icons/icon-192.png" alt=""><span>FREIGHT CHAIN</span></div>
        <div class="lbl">00 · The driver</div>
        <h1>Andrei<small>solo founder · Belgrade</small></h1>
        ${pts(['Ex-tech lead · Latoken · chain integrations', 'Winner · Moralis × Cronos GameFi', 'Fully featured product, not a game prototype', 'Site · streams · analytics · Solana escrow', 'I ship really fast', '<b>Co-founder wanted</b>'])}
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
        ${pts(['Truck sim', 'Attention to details', 'Gamedev best practices', 'Hybrid anti-cheat', 'Soulbound NFT achievements'])}
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
        <div class="badge live">● LIVE · NO WALLET TO WATCH</div>
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
        <div class="split" role="img" aria-label="70 percent to finishers, 20 percent to the next pool, 10 percent fee">
          <div style="--w:70"><b>70%</b><span>finishers · by distance</span></div>
          <div style="--w:20"><b>20%</b><span>next pool</span></div>
          <div style="--w:10"><b>10%</b><span>fee</span></div>
        </div>
        ${pts(['Too few tickets · refund, without me', 'Road seed committed on chain', 'Pays only attested rides'])}
        <div class="fine">DEVNET · NOT AUDITED · NO TOKEN</div>
      </div>
      <div class="vis">
        ${shot('wp-diagram.webp', 'v-main diagram', 'Where the money goes')}
        ${shot('escrow-flow.webp', 'v-sub', 'How the escrow works')}
        <img class="glyph g1" src="${A}proof.svg" alt="Four 15-second batches hash up into one Merkle root">
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

/* ── engine ── */
const deck = document.getElementById('deck');
deck.innerHTML = SLIDES.map((s, i) => `<section class="slide L-${s.layout.split(' ').join(' L-')}" id="s-${s.id}" data-i="${i}">${s.html}<div class="num">${String(i + 1).padStart(2, '0')} / ${String(SLIDES.length).padStart(2, '0')}</div></section>`).join('');
deck.querySelectorAll('[data-chart=funnel]').forEach(funnel);
deck.querySelectorAll('[data-chart=daily]').forEach(daily);

const slides = [...deck.children];
const stage = document.getElementById('stage');
let scale = 1;   // stage px → screen px
const fit = () => { const k = scale = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `translate(-50%,-50%) scale(${k})`; };
addEventListener('resize', fit); fit();

let cur = -1;
function show(i) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  if (i === cur) return;
  slides.forEach((s, j) => s.classList.toggle('on', j === i));
  slides.forEach((s, j) => s.querySelectorAll('video').forEach(v => { if (j === i) start(v); else v.pause(); }));
  cur = i;
  history.replaceState(null, '', '#' + (i + 1));
  document.getElementById('bar').style.width = `${100 * (i + 1) / slides.length}%`;
}
const start = v => v.play().catch(() => {});

addEventListener('keydown', e => {
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(cur + 1); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key)) show(cur - 1);
  else if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
  else if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
});
/* slide 1's cards and tags: the mouse nudges them (parallax), a tap / click lifts one (.hot) instead of turning the page */
const wall = document.querySelector('.L-wall .vis');
wall?.parentElement.addEventListener('pointermove', e => { wall.style.setProperty('--px', (e.clientX / innerWidth - .5).toFixed(3)); wall.style.setProperty('--py', (e.clientY / innerHeight - .5).toFixed(3)); });
wall?.parentElement.addEventListener('pointerleave', () => { wall.style.setProperty('--px', 0); wall.style.setProperty('--py', 0); });
/* dragging a screen: it follows the pointer at about half the distance, trailing behind (a slow lerp), and eases home when let go */
const drags = new Map(); let raf = 0, moved = false;
function trail() {
  let busy = false;
  drags.forEach((d, c) => {
    d.x += (d.tx - d.x) * .06; d.y += (d.ty - d.y) * .06;
    c.style.setProperty('--dx', `${d.x.toFixed(1)}px`); c.style.setProperty('--dy', `${d.y.toFixed(1)}px`);
    if (!d.down && Math.abs(d.x) < .3 && Math.abs(d.y) < .3) { c.classList.remove('drag'); c.style.removeProperty('--dx'); c.style.removeProperty('--dy'); drags.delete(c); } else busy = true;
  });
  raf = busy ? requestAnimationFrame(trail) : 0;
}
wall?.querySelectorAll('.shot').forEach(c => {
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

addEventListener('click', e => {
  const card = e.target.closest('.L-wall .shot, .L-wall .tags span');
  if (card) {
    if (moved) { moved = false; return; }   // the end of a drag is not a tap
    const on = card.classList.toggle('hot'); wall.querySelectorAll('.hot').forEach(c => { if (c !== card && on) c.classList.remove('hot'); });
    return;
  }
  if (e.target.closest('a,button')) return;
  show(cur + (e.clientX > innerWidth / 3 ? 1 : -1));
});

const tip = document.getElementById('tip');
addEventListener('mousemove', e => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  tip.hidden = false; tip.textContent = t.dataset.tip; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px';
});

const fromHash = () => show((parseInt(location.hash.slice(1), 10) || 1) - 1);
addEventListener('hashchange', fromHash);
fromHash();
