import { api, signIn } from '../../client/site/wallet.js';   // one sign-in implementation for landing + lobby (Vite bundles it; fs.allow in vite.config.js for dev)
import { GAME_BASE } from '../../client/js/hosts.js';   // '' on localhost, https://ride.<apex> in production: the game is NOT on the landing's host there
import { sol, km, left, dur, short, hue, hours, ago, plural, TIER, TIER_LONG, ROUTE } from './format.js';

/* Landing: four chapters (ride · loop · economy · about), fed by the public API only – no session needed to look.
   Everything from the server goes in with textContent (other riders' wallets are rendered here). */

/* ───── things to fill in ───── */
const HERO_VIDEO = null;          // e.g. '/media/hero.mp4' – a muted gameplay loop; null = the Ken Burns slideshow of screenshots
const DEMO_VIDEO = null;          // e.g. '/media/demo.mp4' – the ≤ 3 min product demo; null = the dialog explains and links to offline play
const SOCIALS = { x: null, discord: null, telegram: null };   // URLs; null hides the button (Q11 in docs/hackathon-plan-v2.md; files go in landing/public/media/)

const $ = id => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
const avatar = w => el('i', { class: 'av', style: `background:hsl(${hue(w)} 60% 50%)` });
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const S = { pool: null, live: null, board: null, skew: 0, me: null };
const now = () => Date.now() + S.skew;

/* ───── odometer-ish counters: tween the displayed number towards the real one ───── */
function count(elm, target, fmt) {
  const from = +elm.dataset.v || 0; elm.dataset.v = target;
  if (reduced || from === target) { elm.textContent = fmt(target); return; }
  const t0 = performance.now(), T = 900;
  const step = t => { const k = Math.min(1, (t - t0) / T), e = 1 - (1 - k) ** 3; elm.textContent = fmt(from + (target - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* ───── hero stats + pool card ───── */
function paintHero() {
  const p = S.pool, l = S.live;
  if (p) {
    count($('hero-pot'), p.split.grand, v => sol(v));
    $('hero-usd').textContent = p.usd.grand != null ? `≈ $${p.usd.grand}` : '';
    $('hero-cd').textContent = left(p.round.endsAt - now());
  }
  if (l) {
    count($('hero-live'), l.rides.length, v => String(Math.round(v)));
    count($('hero-km'), l.totals.metres, v => km(v));
    $('hero-shifts').textContent = l.totals.shifts;
    $('chip-live').textContent = `${l.rides.length} ON THE ROAD`; $('soc-live').textContent = l.rides.length;
  }
  paintBoardsLive();
}

/* the load board (06) and the trip sheet (05): live cells only where the server knows the number */
function paintBoardsLive() {
  const p = S.pool, l = S.live;
  if (l) { $('lb-drivers').textContent = plural(l.totals.drivers, 'driver'); $('lb-live').textContent = `${l.rides.length} on the road now`; $('sheet-km').textContent = km(l.totals.metres); }
  if (p) { $('lb-entries').textContent = `${p.entries} this round`; $('lb-pot').textContent = `${sol(p.split.grand)} SOL`; }
}

function paintPool() {
  const box = $('poolbox'), p = S.pool;
  if (!p) { box.replaceChildren(el('span', { class: 'dim' }, 'Prize pool unavailable right now.')); return; }
  const s = p.split, parts = [s.grand, s.top20, s.nextSeed, s.fees], total = parts.reduce((x, y) => x + y, 0), pct = total ? parts.map(x => (x / total) * 100) : [50, 20, 20, 10];
  const part = (cls, label, l) => el('span', { class: cls }, `${label} `, el('b', {}, `${sol(l)} SOL`));
  box.replaceChildren(
    el('span', { class: 'lbl' }, 'GRAND PRIZE · ACCRUED THIS WEEK'),
    el('div', { class: 'big' }, `${sol(s.grand)} SOL`),
    el('div', { class: 'usd' }, p.usd.grand != null ? `≈ $${p.usd.grand} at the current price${p.solUsd ? ` · SOL $${p.solUsd}` : ''}` : ''),
    el('div', { class: 'split' }, ...['s-grand', 's-top', 's-seed', 's-fees'].map((c, i) => el('i', { class: c, style: `width:${pct[i]}%` }))),
    el('div', { class: 'legend' }, part('s-grand', '50% grand prize · draw, weight = tier', s.grand), part('s-top', '20% top 20 · by distance', s.top20), part('s-seed', '20% seeds next week', s.nextSeed), part('s-fees', '10% platform', s.fees)),
    el('div', { class: 'meta' }, el('span', {}, el('b', {}, p.entries), ` paid ${p.entries === 1 ? 'entry' : 'entries'}`), el('span', {}, 'closes in ', el('b', { class: 'cd' }, left(p.round.endsAt - now()))), el('span', {}, s.carry ? ['carried from last week: ', el('b', {}, `${sol(s.carry)} SOL`)] : 'first round – nothing carried yet')),
    el('div', { class: 'dim' }, 'Integer lamports, floored shares, remainder to fees. settled: false – the draw and payouts are not live in this build.'));
}

function paintTiers(t) {
  const rows = t.tiers.map(x => el('tr', {}, el('td', {}, TIER_LONG[x.id] ?? x.id), el('td', {}, hours(x.seconds)), el('td', {}, x.usd ? `$${x.usd}` : 'free'), el('td', {}, x.lamports ? `${sol(x.lamports)} SOL` : '–')));
  $('tiers').replaceChildren(el('thead', {}, el('tr', {}, ...['SHIFT', 'LENGTH', 'PRICE', 'IN SOL'].map(h => el('th', {}, h)))), el('tbody', {}, rows));
  $('price').textContent = t.solUsd ? `SOL ≈ $${t.solUsd}. The quote is locked for 10 minutes when you order. Devnet SOL only.` : 'SOL price unavailable right now.';
}

/* ───── boards ───── */
const empty = txt => [el('span', { class: 'dim' }, txt)];
function paintBoards() {
  const l = S.live;
  if (l) {
    $('board-live').replaceChildren(...(l.rides.length ? l.rides.slice(0, 8).map(r => el('div', { class: 'r' },
      el('span', { class: 'w' }, avatar(r.wallet), short(r.wallet), el('small', {}, TIER[r.tier] ?? r.tier, r.route ? ` · ${ROUTE[r.route] ?? r.route}` : '')),
      el('span', {}, ''),
      el('span', { class: 'v lcd' }, r.paused ? 'PAUSED' : `${dur(r.driveSeconds)} / ${dur(r.minSeconds)}`),
      el('span', { class: 'bar' }, el('i', { style: `width:${Math.round(r.progress * 100)}%` })))) : empty('Nobody on the road right now. Start a free ride and be the first row.')));
    $('board-next').replaceChildren(...(l.upcoming.length ? l.upcoming.slice(0, 8).map(r => el('div', { class: 'r' },
      el('span', { class: 'w' }, avatar(r.wallet), short(r.wallet), el('small', {}, TIER[r.tier] ?? r.tier)),
      el('span', {}, ''),
      el('span', { class: 'v' }, `paid ${ago(now() - r.paidAt)}`))) : empty('No paid shift waiting to start. A paid order sits here until its driver turns the key.')));
  }
  if (S.board) {
    const rows = S.board.rows.slice(0, 10);
    $('board-top').replaceChildren(...(rows.length ? rows.map(r => el('div', { class: `r${S.me && r.wallet === S.me.wallet ? ' me' : ''}` },
      el('span', { class: 'n' }, `#${r.rank}`),
      el('span', { class: 'w' }, avatar(r.wallet), short(r.wallet), el('small', {}, plural(r.rides, 'ride'))),
      el('span', { class: 'v' }, `${km(r.distance)} km`))) : empty('No finished paid shift this round yet. The first finisher is #1.')));
  }
}

/* ───── ticker ───── */
function paintTicker() {
  const l = S.live, p = S.pool, items = [];
  if (l) for (const r of l.recent.slice(0, 8)) items.push(`${short(r.wallet)} ${r.status === 'completed' ? 'finished' : r.status === 'failed' ? 'wrecked' : 'abandoned'} a ${TIER_LONG[r.tier]?.toLowerCase() ?? r.tier} shift${r.route ? ` on ${ROUTE[r.route] ?? r.route}` : ''} · ${km(r.distance)} km`);
  if (p) items.push(`${sol(p.split.grand)} SOL in the pot · ${plural(p.entries, 'paid entry', 'paid entries')} this round`);
  if (l) {
    items.push(`${plural(l.rides.length, 'truck')} on the road right now`, `${km(l.totals.metres)} km driven by ${plural(l.totals.drivers, 'driver')} all time`);
    if (l.upcoming.length) items.push(`${plural(l.upcoming.length, 'paid shift')} waiting to start`);
  }
  if (!items.length) items.push('Dispatch is quiet. Connect a wallet, take a free ride, be the first line on this ticker.');
  const nodes = items.map(t => el('span', {}, t));
  $('ticker').replaceChildren(...nodes, ...nodes.map(n => n.cloneNode(true)));   // doubled so the -50% translate loops seamlessly
}

/* ───── data ───── */
async function refresh() {
  const [p, l] = await Promise.all([api('pool').catch(() => null), api('live').catch(() => null)]);
  if (p) S.pool = p;
  if (l) { S.live = l; S.skew = l.now - Date.now(); }
  paintHero(); paintPool(); paintBoards(); paintTicker();
}
async function refreshBoard() { S.board = await api('leaderboard?board=round').catch(() => null); paintBoards(); }

/* ───── hero video / demo dialog ───── */
(() => {
  const v = $('hero-video');
  if (HERO_VIDEO && !reduced) { v.src = HERO_VIDEO; v.hidden = false; $('slides').hidden = true; v.onerror = () => { v.hidden = true; $('slides').hidden = false; }; }
  const dlg = $('demo'), dv = $('demo-video');
  $('demo-btn').onclick = () => {
    if (DEMO_VIDEO) { dv.src = DEMO_VIDEO; $('demo-note').textContent = 'Demo clock ×60 – a paid shift is shortened for the demo wallet; the speed bound is not.'; }
    else { dv.removeAttribute('src'); $('demo-note').replaceChildren('The demo video is not here yet. ', el('a', { href: `${GAME_BASE}/play.html` }, 'Try the game offline'), ' – no wallet, no server, same truck.'); }
    dlg.showModal(); if (DEMO_VIDEO) dv.play().catch(() => {});
  };
  const close = () => { dv.pause(); dlg.close(); };
  $('demo-x').onclick = close; dlg.onclick = e => { if (e.target === dlg) close(); };
})();

/* ───── links to the game (static markup says /play.html; on split hosts that lives on ride.<apex>) ───── */
for (const a of document.querySelectorAll('a[href="/play.html"]')) a.href = `${GAME_BASE}/play.html`;

/* ───── socials ───── */
for (const [net, url] of Object.entries(SOCIALS)) if (url) $('socials').append(el('a', { href: url, 'data-net': net, target: '_blank', rel: 'noopener' }, net.toUpperCase()));

/* ───── sign-in / CTA ───── */
const btn = $('connect'), msg = $('msg'), playTop = $('play-top');
const toLobby = () => { location.href = '/lobby.html'; };
btn.onclick = async () => {
  btn.disabled = true; msg.textContent = 'Approve the sign-in message in your wallet…'; msg.className = 'msg';
  try { await signIn(); toLobby(); } catch (e) { msg.textContent = e.message; msg.className = 'msg bad'; btn.disabled = false; }
};
playTop.onclick = () => { if (S.me) toLobby(); else { location.hash = '#ride'; btn.focus(); } };
api('me').then(m => { S.me = m; btn.textContent = 'OPEN THE LOBBY →'; btn.onclick = toLobby; playTop.textContent = 'LOBBY'; paintBoards(); }, () => {});   // signed in already: no forced redirect – the pool is the point of this page

/* ───── dash cards: footer colours sampled from the image, tilt follows the pointer ───── */
function sampleColours(card, img) {
  try {
    const cv = document.createElement('canvas'), w = cv.width = 48, h = cv.height = 48, g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data;
    const avg = (y0, y1) => { let r = 0, gg = 0, b = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; } return [r / n, gg / n, b / n]; };
    const lift = ([r, g2, b], k) => `rgb(${Math.round(r * k + 22)} ${Math.round(g2 * k + 19)} ${Math.round(b * k + 16)})`;   // the crops are mostly dash-black: lift so the footer reads as a tint, not a void
    const top = avg(0, h >> 1), bottom = avg(h >> 1, h);
    const vivid = (() => { let best = null, bs = -1; for (let i = 0; i < d.length; i += 16) { const r = d[i], g2 = d[i + 1], b = d[i + 2], mx = Math.max(r, g2, b), mn = Math.min(r, g2, b), sat = mx ? (mx - mn) / mx : 0, score = sat * mx; if (score > bs) { bs = score; best = [r, g2, b]; } } return best; })();
    card.style.setProperty('--c1', lift(vivid ? vivid.map((v, i) => v * .55 + top[i] * .45) : top, .8));
    card.style.setProperty('--c2', lift(vivid ? vivid.map((v, i) => v * .2 + bottom[i] * .8) : bottom, .7));
    const lum = ([r, g2, b]) => (.2126 * r + .7152 * g2 + .0722 * b) / 255;
    card.style.setProperty('--fg', lum(top) > .5 ? '#1b1408' : 'var(--cream)');
  } catch { /* cross-origin or decode failure: keep the default dash colours */ }
}
for (const card of document.querySelectorAll('.card3d')) {
  const img = card.querySelector('img');
  if (img.complete && img.naturalWidth) sampleColours(card, img); else img.addEventListener('load', () => sampleColours(card, img), { once: true });
  if (reduced) continue;
  const MAX = 11;   // degrees at the card edge
  let r = null;   // measured once per hover: reading the rect on every pointermove forces a layout each time
  card.addEventListener('pointerenter', () => { r = card.getBoundingClientRect(); });
  card.addEventListener('pointermove', e => {
    r ??= card.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    card.classList.add('live');
    card.style.setProperty('--rx', `${((.5 - py) * MAX * 2).toFixed(2)}deg`); card.style.setProperty('--ry', `${((px - .5) * MAX * 2).toFixed(2)}deg`);
  });
  card.addEventListener('pointerleave', () => { r = null; card.classList.remove('live'); card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', 'var(--base, 0deg)'); });
}

/* the cards render with the game's own cockpit code once they are near the viewport (the PNGs above stay as the fallback and the colour source) */
const liveCards = [...document.querySelectorAll('.card3d[data-live]')];
if (liveCards.length) {
  const lio = new IntersectionObserver(es => { if (!es.some(e => e.isIntersecting)) return; lio.disconnect(); import('./dash-live.js').then(m => m.startLiveDash(liveCards)).catch(e => console.warn('live dash cards unavailable', e)); }, { rootMargin: '600px' });
  lio.observe($('cards'));
}

/* ───── scroll reveal + section highlight ───── */
const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px' });
document.querySelectorAll('.rv').forEach(n => io.observe(n));
const nav = [...document.querySelectorAll('.nav a')];
const so = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) nav.forEach(a => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`)); }, { rootMargin: '-40% 0px -55% 0px' });
document.querySelectorAll('section[id]').forEach(s => so.observe(s));

/* ───── boot ───── */
refresh();
api('tiers').then(paintTiers, () => { $('tiers').replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'dim' }, 'Prices unavailable right now.')))); });
refreshBoard();
setInterval(() => { if (!document.hidden) refresh(); }, 10000);
setInterval(() => { if (!document.hidden) refreshBoard(); }, 30000);
setInterval(() => { if (document.hidden) return; $('lb-clock').textContent = new Date(now()).toISOString().slice(11, 19); if (!S.pool) return; const t = left(S.pool.round.endsAt - now()); $('hero-cd').textContent = t; document.querySelectorAll('.pool .cd').forEach(c => { c.textContent = t; }); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
