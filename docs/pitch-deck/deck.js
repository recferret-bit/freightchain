/* Freight Chain pitch deck – one content file, three themes (option-*.html).
   Keys: → / space next · ← back · F fullscreen · N script notes · P play to the script clock · Home / End.
   Every number on the traction slide is PostHog EU, Oct 8–12 2026, distinct people (see DATA). */

const A = 'assets/';
const shot = (src, cls = '', alt = '') => `<figure class="shot ${cls}"><img src="${A}${src}" alt="${alt}" loading="eager"></figure>`;
const clip = (src, cls = '', seg = '') => `<figure class="shot clip ${cls}"><video src="${A}${src}" muted playsinline loop preload="auto" ${seg ? `data-seg="${seg}"` : ''}></video></figure>`;
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
  { t: 0, layout: 'wall', id: 'driver',
    notes: "I'm Andrei. I build alone, in Belgrade. I was a tech lead at Latoken, on chain integrations, and I won the Moralis and Cronos GameFi hackathon. The truck was already driving. These two weeks I put a real product around it. A site. Streams. Analytics. Solana escrow.",
    html: `
      <div class="copy">
        <div class="brand"><img src="${A}icon.png" alt=""><span>FREIGHT CHAIN</span></div>
        <div class="lbl">00 · The driver</div>
        <h1>Andrei<small>solo founder · Belgrade</small></h1>
        ${pts(['Ex-tech lead · Latoken · chain integrations', 'Winner · Moralis × Cronos GameFi', 'Fully featured product, not a game prototype', 'Site · streams · analytics · Solana escrow', 'I ship really fast', '<b>Co-founder wanted</b>'])}
      </div>
      <div class="vis">
        ${shot('landing-hero.jpg', 'w1', 'The landing')}
        ${shot('watch-replay.jpg', 'w2', 'Watching a replay')}
        ${shot('wp-onchain.jpg', 'w3', 'Whitepaper, on-chain chapter')}
        ${shot('receipt-card.jpg', 'w4', 'A public ride receipt')}
        <div class="tags"><span>SITE</span><span>STREAMS</span><span>ANALYTICS</span><span>SOLANA ESCROW</span></div>
      </div>` },

  { t: 22, layout: 'bleed', id: 'game',
    notes: 'Freight Chain. A truck cab. A road that never ends. Your shift does. One mistake ends it. Manual gearbox. A cold engine. Night. Traffic. Speed stays near one hundred. You cannot skip the clock.',
    html: `
      <video class="bg" src="${A}hero-preview.mp4" poster="${A}hero-poster.webp" muted playsinline loop preload="auto"></video>
      <div class="shade"></div>
      <div class="copy">
        <div class="lbl">01 · The game</div>
        <h1>The road never ends.<br><em>Your shift does.</em></h1>
        ${pts(['Truck sim', 'Attention to details', 'Gamedev best practices', 'Hybrid anti-cheat', 'Soulbound NFT achievements'])}
      </div>
      <div class="vis">${shot('01-one-mistake.jpg', 'poster', 'One mistake ends the shift')}</div>` },

  { t: 40, layout: 'split', id: 'insight',
    notes: 'People will not come to Solana for another pool. They already watch long, tense streams. So the game is the door. They come for the cab. The wallet shows up when they want a seat. The stream is the ad.',
    html: `
      <div class="copy">
        <div class="lbl">02 · The insight</div>
        <h1>The game<br>is the door.</h1>
        ${pts(['Native streams and replays', 'Donations and chat', 'Web2 friendly', "I'm chasing Web3 adoption a lot", '<b>The stream is the ad</b>'])}
      </div>
      <div class="vis">
        ${clip('promo.mp4', 'v-main', '16,24')}
        <div class="badge live">● LIVE · NO WALLET TO WATCH</div>
      </div>` },

  { t: 60, layout: 'split flip', id: 'play',
    notes: 'Play it free tonight. Ten free rides. No download. Watch a live haul, or a replay, with no wallet. A paid seat is a one-hour shift, a few dollars in SOL, one signature. Four hours and eight hours come after that. The one-hour pool is on devnet. The site still says the paid shifts are soon.',
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
        ${shot('game-guest.jpg', 'v-main', 'Free run in the cab')}
        ${shot('receipt-card.jpg', 'v-sub receipt', 'Ride receipt')}
      </div>` },

  { t: 82, layout: 'money', id: 'money',
    notes: 'Seventy percent of every pool goes to the drivers who finish, ranked by distance. Twenty percent starts the next pool. Ten percent is the fee. The program holds the money. If too few tickets sell, it can be sent back without me. The chain commits the road, so I cannot pick an easy one. The vault pays only a ride that has been attested. Devnet. Not audited. No token.',
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
        ${shot('wp-diagram.jpg', 'v-main diagram', 'Where the money goes')}
        ${shot('escrow-flow.jpg', 'v-sub', 'How the escrow works')}
        <img class="glyph g1" src="${A}proof.svg" alt="Four 15-second batches hash up into one Merkle root">
      </div>` },

  { t: 108, layout: 'chart', id: 'traction',
    notes: 'One hundred seventy-seven people in eight days. About half of them watched the film. The first players are finishing rides. Wallets are still rare. That is the number I work on next.',
    warn: 'Check before recording: PostHog has 104 landing visitors (Oct 8–12). 177 counts the deploy smoke-test wallets. Every finished ride is the demo wallet.',
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

  { t: 125, layout: 'end', id: 'next',
    notes: 'Solana Ecosystem track. Next is a real payout on devnet, then an audit, then mainnet, then more games on the same rails.',
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
        ${shot('landing-roadmap.jpg', 'v-main', 'Roadmap trip sheet')}
        <div class="badges">${['shift-complete-4', 'night-owl-4', 'century-4', 'clean-run-4', 'cold-start-4', 'first-mile-4'].map(b => `<img src="${A}badge-${b}.svg" alt="">`).join('')}</div>
      </div>` },

  { t: 140, layout: 'end gtm', id: 'market',
    notes: '(No script line for this slide yet.)',
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
        ${shot('landing-market.jpg', 'v-main', 'Go to market load board')}
      </div>` },
];
const END = 155;   // seconds – the script's last line, read at speaking pace

/* ── charts (SVG, single hue per chart: magnitude, not identity) ── */
const css = n => getComputedStyle(document.body).getPropertyValue(n).trim();
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
const fit = () => { const k = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `translate(-50%,-50%) scale(${k})`; };
addEventListener('resize', fit); fit();

let cur = -1;
function show(i) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  if (i === cur) return;
  slides.forEach((s, j) => s.classList.toggle('on', j === i));
  slides.forEach((s, j) => s.querySelectorAll('video').forEach(v => { if (j === i) start(v); else v.pause(); }));
  cur = i;
  history.replaceState(null, '', '#' + (i + 1));
  document.getElementById('notes-text').textContent = SLIDES[i].notes;
  document.getElementById('notes-warn').textContent = SLIDES[i].warn || '';
  document.getElementById('bar').style.width = `${100 * (i + 1) / slides.length}%`;
}
function start(v) {
  const seg = v.dataset.seg?.split(',').map(Number);
  if (seg) {
    const go = () => { v.currentTime = seg[0]; v.play().catch(() => {}); };
    v.ontimeupdate = () => { if (v.currentTime >= seg[1] || v.currentTime < seg[0] - 0.5) v.currentTime = seg[0]; };
    v.readyState >= 1 ? go() : v.addEventListener('loadedmetadata', go, { once: true });
  } else v.play().catch(() => {});
}

/* P: advance on the script's timestamps – read along and record */
let clock = null, t0 = 0;
function playClock() {
  if (clock) { clearInterval(clock); clock = null; document.body.classList.remove('playing'); return; }
  t0 = performance.now() - SLIDES[Math.max(cur, 0)].t * 1000;
  document.body.classList.add('playing', 'notes');
  clock = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    let i = 0; SLIDES.forEach((s, j) => { if (t >= s.t) i = j; });
    show(i);
    document.getElementById('clock').textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} / ${Math.floor(END / 60)}:${String(END % 60).padStart(2, '0')}`;
    if (t > END) playClock();
  }, 100);
}

addEventListener('keydown', e => {
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(cur + 1); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key)) show(cur - 1);
  else if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
  else if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  else if (e.key === 'n' || e.key === 'N') document.body.classList.toggle('notes');
  else if (e.key === 'p' || e.key === 'P') playClock();
});
addEventListener('click', e => { if (e.target.closest('a,button')) return; show(cur + (e.clientX > innerWidth / 3 ? 1 : -1)); });

const tip = document.getElementById('tip');
addEventListener('mousemove', e => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  tip.hidden = false; tip.textContent = t.dataset.tip; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 14 + 'px';
});

const fromHash = () => show((parseInt(location.hash.slice(1), 10) || 1) - 1);
addEventListener('hashchange', fromHash);
fromHash();
setTimeout(() => document.getElementById('help').classList.add('gone'), 5000);
