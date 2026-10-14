import { api, signIn, walletName } from '../../client/site/wallet.js';   // one sign-in implementation for landing + lobby (Vite bundles it; fs.allow in vite.config.js for dev)
import { API_BASE, GAME_BASE, SITE_BASE, STORYBOOK_BASE, WHITEPAPER_BASE } from '../../client/js/hosts.js';   // '' on localhost; in production the game is on ride.<apex>, NOT the landing's host, and SITE_BASE is the apex
import { track, flushSoon } from '../../client/js/analytics.js';
import { reportWebVitals } from '../../client/js/web-vitals.js';
import { livePath, leaveOnClose } from '../../client/site/presence.js';   // this page counts as online in the live feed – and leaves it when closed
import { sol, km, left, short, hue, hours, driven, ago, plural, TIER, TIER_LONG, ROUTE } from './format.js';
import { heldTickets, escrowExplainer, explorerUrl, shortAddr, progressText, phaseLine, poolPhase } from '../../client/site/pools.js';   // the lobby's pool wording, so both pages say the same thing
import { isMobileDevice } from '../../client/js/mobile.js';
import { bindAnchors } from './anchor.js';

bindAnchors();   // before the chapter observer, so a #faq load is already on the heading it highlights

/* Landing: seven chapters (ride · loop · economy · roadmap · market · about · faq), fed by the public API only – no session needed to look.
   Everything from the server goes in with textContent (other riders' wallets are rendered here). */
reportWebVitals('landing');   // before the first track(), so the leave flush includes the final metrics

/* ───── things to fill in ───── */
const DEMO_VIDEO = '/media/demo.mp4';  // the demo clip, served by our own host (nginx caches /media/*.mp4 and answers Range); to move it to a CDN put the full https URL here; null = the dialog explains and links to offline play
const SOCIALS = { x: 'https://x.com/FreightChainSol', youtube: 'https://www.youtube.com/@FreightChainGame', discord: null, telegram: null };   // URLs; null hides the button (files go in landing/public/media/; the hero loop is `data-src` on #hero-video in index.html)

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
    const esc = p.pools?.length ? p.pools.reduce((a, x) => a + x.vaultLamports, 0) : null;
    if (esc != null) {
      $('hero-pot-lbl').textContent = `IN ESCROW · ${plural(p.pools.length, 'POOL', 'POOLS')}`;
      count($('hero-pot'), esc, v => sol(v));
      $('hero-usd').textContent = p.solUsd ? `≈ $${((esc / 1e9) * p.solUsd).toFixed(2)}` : '';
      if ($('hero-pot-note')) $('hero-pot-note').hidden = true;
    } else {
      $('hero-pot-lbl').textContent = 'ACCRUED THIS WEEK · NOT PAID';
      if (p.split.grand > 0) count($('hero-pot'), p.split.grand, v => sol(v));
      else $('hero-pot').textContent = '–';
      $('hero-usd').textContent = p.split.grand > 0 && p.usd.grand != null ? `≈ $${p.usd.grand}` : '';
      if ($('hero-pot-note')) {
        $('hero-pot-note').hidden = false;
        $('hero-pot-note').textContent = 'Free rides and practice are open. No prize has been paid.';
      }
    }
    $('hero-cd').textContent = left(p.round.endsAt - now());
  }
  if (l) {
    count($('hero-live'), l.rides.length, v => String(Math.round(v)));
    count($('hero-km'), l.totals.metres, v => km(v));
    $('hero-shifts').textContent = plural(l.totals.rides, 'ride');
    $('hero-time').textContent = driven(l.totals.seconds);
    $('chip-live').textContent = `${l.online ? `${l.online.total} ONLINE · ` : ''}${l.rides.length} ON THE ROAD`; $('soc-live').textContent = l.rides.length;
  }
  paintBoardsLive();
}

/* the load board (05) and the trip sheet (04): live cells only where the server knows the number */
function paintBoardsLive() {
  const p = S.pool, l = S.live;
  if (l) { $('lb-drivers').textContent = plural(l.totals.drivers, 'driver'); $('lb-live').textContent = `${l.rides.length} on the road now`; $('sheet-km').textContent = km(l.totals.metres); }
  if (p) {
    const esc = p.pools?.length;
    $('lb-entries').textContent = esc ? `${p.entries} this round` : 'devnet soon';
    $('lb-pot').textContent = esc ? `${sol(p.pools.reduce((a, x) => a + x.vaultLamports, 0))} SOL` : '–';
    $('lb-tickets-st').textContent = esc ? 'ROLLING · DEVNET' : 'SOON'; $('lb-tickets-st').className = esc ? 'rolling' : 'bid';
    $('lb-pools-st').textContent = esc ? 'ACCRUING' : 'SOON'; $('lb-pools-st').className = esc ? 'rolling' : 'bid';
  }
}

function paintPool() {
  const box = $('poolbox'), p = S.pool;
  if (!p) { box.replaceChildren(el('span', { class: 'dim' }, 'Prize pool unavailable right now.')); return; }
  const s = p.split, parts = [s.grand, s.top20, s.nextSeed, s.fees], total = parts.reduce((x, y) => x + y, 0), pct = total ? parts.map(x => (x / total) * 100) : [50, 20, 20, 10];
  const part = (cls, label, l) => el('span', { class: cls }, `${label} `, el('b', {}, `${sol(l)} SOL`));
  const esc = p.pools?.length ? p.pools.reduce((a, x) => a + x.vaultLamports, 0) : null;
  if (esc == null) {
    box.replaceChildren(
      el('span', { class: 'lbl' }, 'WEEKLY ROUND · ACCRUED, NOT PAID'),
      el('div', { class: 'big' }, `${sol(s.grand)} SOL`),
      el('div', { class: 'usd' }, p.usd.grand != null ? `≈ $${p.usd.grand}` : 'No prize has been paid out'),
      el('div', { class: 'split' }, ...['s-grand', 's-top', 's-seed', 's-fees'].map((c, i) => el('i', { class: c, style: `width:${pct[i]}%` }))),
      el('div', { class: 'legend' }, part('s-grand', '50% grand prize · accrued', s.grand), part('s-top', '20% top 20 · by distance', s.top20), part('s-seed', '20% seeds next week', s.nextSeed), part('s-fees', '10% platform', s.fees)),
      el('div', { class: 'meta' }, el('span', {}, el('b', {}, 'Free rides and practice are open'), ' · paid shifts are marked soon')),
      el('div', { class: 'dim' }, 'Integer lamports, floored shares, remainder to fees. This round is accounted. It is not paid out.'));
    return;
  }
  box.replaceChildren(
    el('span', { class: 'lbl' }, 'GRAND PRIZE · ACCRUED THIS WEEK'),
    el('div', { class: 'big' }, `${sol(s.grand)} SOL`),
    el('div', { class: 'usd' }, p.usd.grand != null ? `≈ $${p.usd.grand} at the current price${p.solUsd ? ` · SOL $${p.solUsd}` : ''}` : ''),
    el('div', { class: 'split' }, ...['s-grand', 's-top', 's-seed', 's-fees'].map((c, i) => el('i', { class: c, style: `width:${pct[i]}%` }))),
    el('div', { class: 'legend' }, part('s-grand', '50% grand prize · accrued', s.grand), part('s-top', '20% top 20 · by distance', s.top20), part('s-seed', '20% seeds next week', s.nextSeed), part('s-fees', '10% platform', s.fees)),
    el('div', { class: 'meta' }, el('span', {}, el('b', {}, p.entries), ` paid ${p.entries === 1 ? 'entry' : 'entries'}`), el('span', {}, 'closes in ', el('b', { class: 'cd' }, left(p.round.endsAt - now()))), el('span', {}, s.carry ? ['carried from last week: ', el('b', {}, `${sol(s.carry)} SOL`)] : 'first round – nothing carried yet')),
    el('div', { class: 'dim' }, 'Integer lamports, floored shares, remainder to fees. This round is accounted. It is not paid out.'));
}

function paintTiers(t) {   // a tier sold through a pool: the ticket price is the pool's (fixed in lamports on chain); an on-sale tier without one: the legacy USD quote; an off-sale tier: soon
  const program = t.paymentMode === 'program';   // ticket-only: an on-sale tier without a live pool has nothing on sale (no pay-per-ride)
  const price = x => x.pool ? `${sol(x.pool.priceLamports)} SOL` : x.lamports ? `${sol(x.lamports)} SOL` : '–';
  const paidWith = x => x.pool ? 'pool ticket' : !x.usd ? 'free' : x.onSale === false ? 'soon' : program ? 'pool ticket · none on sale' : `$${x.usd}`;
  const rows = t.tiers.map(x => el('tr', {}, el('td', {}, TIER_LONG[x.id] ?? x.id), el('td', {}, hours(x.seconds)), el('td', {}, paidWith(x)), el('td', {}, price(x))));
  $('tiers').replaceChildren(el('thead', {}, el('tr', {}, ...['SHIFT', 'LENGTH', 'PAID WITH', 'IN SOL'].map(h => el('th', {}, h)))), el('tbody', {}, rows));
  const pooled = t.tiers.some(x => x.pool), legacy = !program && t.tiers.some(x => x.usd && !x.pool && x.onSale !== false);
  const soonNames = t.tiers.flatMap(x => x.onSale === false && !x.pool && x.usd ? [x.id === '1h' ? '1 hour' : x.id === '4h' ? '4 hour' : '8 hour'] : []);
  const soonText = !soonNames.length ? '' : `The ${soonNames.length === 1 ? soonNames[0] : `${soonNames.slice(0, -1).join(', ')} and ${soonNames.at(-1)}`} shift${soonNames.length === 1 ? ' is' : 's are'} planned and not on sale yet.`;
  $('price').textContent = [pooled && 'Pool tickets: the price is part of the pool’s rules, fixed when it was created.', legacy && (t.solUsd ? `Pay-per-ride: SOL ≈ $${t.solUsd}, the quote is locked for 10 minutes when you order.` : 'Pay-per-ride: SOL price unavailable right now.'), soonText, 'Devnet SOL only.'].filter(Boolean).join(' ');
}

/* the escrowed pools on sale or running (the same list as GET /api/pools, carried by /api/pool so the page polls once) – each with its phase: ON SALE · RIDES COUNT · IN REVIEW · PAYING… */
function paintPools() {
  const box = $('pools'), list = S.pool?.pools;
  if (!list) { box.replaceChildren(...empty('Pools unavailable right now.')); return; }
  if (!list.length) { box.replaceChildren(...empty('No pool on sale right now – the next one opens with the week.')); return; }
  const n = now();
  box.replaceChildren(...list.map(p => {
    const f = phaseLine(p, n);
    return el('div', { class: 'r prow' },
      el('span', { class: 'w' }, el('b', {}, TIER[p.tier] ?? p.tier), el('span', { class: `pst ${f.cls}` }, f.text), el('small', {}, p.label)),
      el('span', { class: 'v' }, `${sol(p.vaultLamports)} SOL in escrow`),
      el('span', { class: 'bar' }, el('i', { style: `width:${p.progressPct}%` })),
      el('span', { class: 'pmeta' }, progressText(p, n), ` · ${sol(p.priceLamports)} SOL a ticket · `,
        el('a', { href: explorerUrl(p.address), target: '_blank', rel: 'noopener', title: p.address }, `pool ${shortAddr(p.address)} ↗`)));
  }));
}

/* WINNERS: the newest pool in review / paying (live pools come soonest-first), else the newest settled one – its top 5 (public standings, provisional until fixed) */
async function refreshWinners() {
  const l = await api('pools', undefined, { report: false }).catch(() => null), box = $('winners');
  const p = l && (l.pools.filter(x => /^(review|payout)$/.test(poolPhase(x, now()))).pop() ?? l.finished[0]);
  const st = p && await api(`pools/${p.id}/standings`, undefined, { report: false }).catch(() => null);
  box.hidden = !st;
  if (st) box.replaceChildren(el('h3', {}, `WINNERS · ${st.label}`, el('span', { class: `pst ${st.final ? 'live' : 'open'}` }, st.final ? 'FINAL' : 'PROVISIONAL')),
    ...(st.ranks.length ? st.ranks.slice(0, 5).map(r => el('div', { class: 'r' }, el('span', { class: 'n' }, `#${r.rank}`),
      el('span', { class: 'w' }, avatar(r.wallet), short(r.wallet), el('small', {}, `${km(r.distance)} km`)), el('span', { class: 'v' }, `${sol(r.lamports)} SOL${r.paid ? ' ✓' : ''}`))) : empty('No verified finisher.')),
    el('a', { class: 'link', href: `${SITE_BASE}/lobby.html#new` }, 'all ranks →'));
}

/* ───── boards ───── */
const empty = txt => [el('span', { class: 'dim' }, txt)];
function paintBoards() {
  const l = S.live;
  if (l) {
    $('board-next').replaceChildren(...(l.upcoming.length ? l.upcoming.slice(0, 8).map(r => el('div', { class: 'r' },
      el('span', { class: 'w' }, avatar(r.wallet), short(r.wallet), el('small', {}, TIER[r.tier] ?? r.tier)),
      el('span', {}, ''),
      el('span', { class: 'v' }, `paid ${ago(now() - r.paidAt)}`))) : empty('No paid shift waiting to start. A paid order sits here until its driver turns the key.')));
  }
  if (S.replays) {   // RECENT RIDES: the last that ended, each opening its replay on the watch page while its recording is kept
    $('board-recent').replaceChildren(...(S.replays.length ? S.replays.map(r => el(r.replay ? 'a' : 'div', { class: 'r r2', ...(r.replay ? { href: watchUrl(r.id), title: `replay ${short(r.wallet)}'s ride` } : {}) },
      el('span', { class: 'w' }, avatar(r.wallet), el('span', { class: 'wt' }, short(r.wallet), el('small', {}, TIER[r.tier] ?? r.tier, r.route ? ` · ${ROUTE[r.route] ?? r.route}` : ''))),
      el('span', { class: 'v' }, r.status === 'completed' ? `${km(r.distance)} km ✓` : r.status === 'failed' ? (r.failCode === 'heartbeat_lost' ? 'signal lost' : 'failed') : 'abandoned'))) : empty('No finished rides yet – the first one shows up here, ready to replay.')));
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
/* live streams: any ride on the road (or its replay once it ended) plays on the game's watch page – play.html?watch=<id> on the game's host */
const watchUrl = id => `${GAME_BASE}/play.html?watch=${encodeURIComponent(id)}`;
function paintTicker() {
  const l = S.live, p = S.pool, items = [];   // a string, or [text, href] for a line that opens the watch page
  if (l) for (const r of l.rides.filter(r => r.tier !== 'free').slice(0, 4)) items.push([`● LIVE · ${short(r.wallet)} on ${r.route ? ROUTE[r.route] ?? r.route : 'the road'} · ${km(r.distance)} km · ▶ watch`, watchUrl(r.id)]);
  if (l) for (const r of l.recent.slice(0, 8)) items.push([`${short(r.wallet)} ${r.status === 'completed' ? 'finished' : r.status === 'failed' ? 'wrecked' : 'abandoned'} a ${TIER_LONG[r.tier]?.toLowerCase() ?? r.tier} shift${r.route ? ` on ${ROUTE[r.route] ?? r.route}` : ''} · ${km(r.distance)} km · ▶ replay`, watchUrl(r.id)]);
  if (p?.pools?.length) items.push(`${sol(p.pools.reduce((a, x) => a + x.vaultLamports, 0))} SOL in escrow across ${plural(p.pools.length, 'prize pool')} · ${plural(p.pools.reduce((a, x) => a + x.toGo, 0), 'more rider')} to go live`);
  else if (p) items.push('Free rides & practice mode active · devnet prize pool opening soon');
  if (l) {
    items.push(`${plural(l.rides.length, 'truck')} on the road right now`, `${km(l.totals.metres)} km driven by ${plural(l.totals.drivers, 'driver')} all time`);
    if (l.upcoming.length) items.push(`${plural(l.upcoming.length, 'paid shift')} waiting to start`);
  }
  if (!items.length) items.push('Dispatch is quiet. Connect a wallet, take a free ride, be the first line on this ticker.');
  const nodes = items.map(t => (Array.isArray(t) ? el('a', { href: t[1], tabindex: '-1' }, t[0]) : el('span', {}, t)));   // tabindex -1: the ticker is aria-hidden; the LIVE NOW board carries the same links for keyboards / screen readers
  $('ticker').replaceChildren(...nodes, ...nodes.map(n => n.cloneNode(true)));   // doubled so the -50% translate loops seamlessly
}

/* ───── data ───── */
async function refresh() {
  const [p, l, h] = await Promise.all([api('pool', undefined, { report: false }).catch(() => null), api(livePath('landing'), undefined, { report: false }).catch(() => null),
    api('replays?limit=8', undefined, { report: false }).catch(() => null)]);   // livePath: this page counts as online
  if (p) S.pool = p;
  if (h) S.replays = h.rows;
  if (l) { S.live = l; S.skew = l.now - Date.now(); }
  paintHero(); paintPool(); paintPools(); paintBoards(); paintTicker();
}
async function refreshBoard() { refreshWinners(); S.board = await api('leaderboard?board=round', undefined, { report: false }).catch(() => null); paintBoards(); }

/* ───── hero video: never on the critical path ─────
   The slideshow (WebP posters) is the hero. A gameplay loop – `data-src` on #hero-video, empty = none – is fetched only AFTER the page has loaded and the browser is idle, never on
   data-saver / reduced motion / phones, and it fades in over the slideshow once it is actually playing; if it errors, the slideshow simply stays. */
const heroVideo = $('hero-video');
function loadHeroVideo() {
  const src = heroVideo.dataset.src;
  if (!src || reduced || navigator.connection?.saveData || matchMedia('(max-width: 700px)').matches) return;
  heroVideo.addEventListener('playing', () => { track('hero_video_started'); heroVideo.classList.add('on'); $('slides').classList.add('off'); }, { once: true });
  heroVideo.addEventListener('error', () => { track('hero_video_failed'); heroVideo.removeAttribute('src'); }, { once: true });
  heroVideo.src = src; heroVideo.play().catch(() => {});
}
const whenIdle = window.requestIdleCallback ?? (f => setTimeout(f, 1200));
if (document.readyState === 'complete') whenIdle(loadHeroVideo, { timeout: 4000 }); else addEventListener('load', () => whenIdle(loadHeroVideo, { timeout: 4000 }), { once: true });

/* ───── demo dialog ───── */
(() => {
  const dlg = $('demo'), box = $('demo-frame');
  $('demo-btn').onclick = () => {
    track('demo_dialog_opened', { has_video: DEMO_VIDEO != null });
    if (DEMO_VIDEO) {   // the <video> exists only while the dialog is open: nothing is fetched until the click
      const v = el('video', { src: DEMO_VIDEO, controls: '', autoplay: '', playsinline: '', preload: 'auto', 'aria-label': 'Freight Chain demo' });
      v.addEventListener('error', () => $('demo-note').textContent = 'The demo video could not be loaded – try again later.');
      box.replaceChildren(v);
      $('demo-note').textContent = 'Devnet demo.';
    } else {
      const practice = el('a', { href: `${GAME_BASE}/play.html?offline=1` }, 'Try the game offline');
      practice.addEventListener('click', async (e) => {
        if (isMobileDevice()) {
          e.preventDefault();
          dlg.close();
          const { showMobileToast } = await import('../../client/js/mobile.js');
          showMobileToast({
            liveAction: `${SITE_BASE}/lobby.html#live`,
            replaysAction: `${SITE_BASE}/lobby.html#replays`,
          });
          return;
        }
        track('offline_practice_clicked');
        flushSoon();
      });
      $('demo-note').replaceChildren('The demo video is not here yet. ', practice, ' – a few free runs, then connect a Solana wallet.');
    }
    dlg.showModal();
  };
  const close = () => { box.replaceChildren(); dlg.close(); };
  $('demo-x').onclick = close; dlg.onclick = e => { if (e.target === dlg) close(); }; dlg.addEventListener('cancel', () => box.replaceChildren());
})();

/* ───── links to the game (static markup says /play.html; on split hosts that lives on ride.<apex>) ───── */
for (const a of document.querySelectorAll('a[href="/play.html"]')) {
  a.href = `${GAME_BASE}/play.html?offline=1`;
  a.addEventListener('click', async (e) => {
    if (isMobileDevice()) {
      e.preventDefault();
      const { showMobileToast } = await import('../../client/js/mobile.js');
      showMobileToast({
        liveAction: `${SITE_BASE}/lobby.html#live`,
        replaysAction: `${SITE_BASE}/lobby.html#replays`,
      });
      return;
    }
    track('offline_practice_clicked');
    flushSoon();
  });
}
$('storybook-link').href = STORYBOOK_BASE || '/viewer.html';   // the model viewer: storybook.<apex> in production, /viewer.html elsewhere
$('whitepaper-link').href = $('whitepaper-cta').href = WHITEPAPER_BASE || '/whitepaper.html';   // the whitepaper: whitepaper.<apex> in production, /whitepaper.html elsewhere
$('storybook-link').addEventListener('click', () => track('storybook_link_clicked'));
$('escrow-link').href = escrowExplainer();   // whitepaper chapter 05 is the one public escrow explainer
for (const a of document.querySelectorAll('a[href^="/whitepaper.html#"]')) if (WHITEPAPER_BASE) a.href = `${WHITEPAPER_BASE}/${a.hash}`;   // deep links straight to whitepaper.<apex> (the apex would only 301 there)

/* ───── UNDER THE HOOD cards: hover (CSS) or a tap (.flip) turns one over; the keyboard gets there by Tab onto a link on the back (:focus-within). A link stays a link.
   chain_card_flipped once per card per load: a tap, or a hover that lasts 0.6 s (a pointer passing over is not a read) ───── */
const flipped = new Set(), seen = card => { if (!flipped.has(card)) { flipped.add(card); track('chain_card_flipped', { card }); } };
for (const c of document.querySelectorAll('.oc')) {
  let dwell = 0;
  c.addEventListener('click', e => { if (!e.target.closest('a') && c.classList.toggle('flip')) seen(c.dataset.card); });
  c.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') dwell = setTimeout(() => seen(c.dataset.card), 600); });
  c.addEventListener('pointerleave', () => clearTimeout(dwell));
}
/* back from a link on a card (bfcache restores the page as it was): the card must not stay turned – drop .flip and the focus :focus-within holds on to */
addEventListener('pageshow', e => { if (!e.persisted) return; for (const c of document.querySelectorAll('.oc.flip')) c.classList.remove('flip'); if (document.activeElement?.closest('.oc')) document.activeElement.blur(); });
/* their drawings come alive as canvas scenes (chain-scenes.js, a lazy chunk) when the grid gets near; reduced motion keeps the still SVGs */
const ocGrid = document.querySelector('.oc-grid');
if (ocGrid && !reduced) {
  const cio = new IntersectionObserver(es => { if (!es.some(e => e.isIntersecting)) return; cio.disconnect(); import('./chain-scenes.js').then(m => m.startChainScenes(ocGrid.querySelectorAll('.oc'))).catch(e => console.warn('chain scenes unavailable', e)); }, { rootMargin: '600px' });
  cio.observe(ocGrid);
}

/* FAQ: hover (a fine pointer) opens the card and leave closes it, unless a click pinned it (.on).
   A click on a hover-open card pins it; the next click unpins and, while the pointer is still inside, .shut keeps it closed until the pointer leaves.
   The chevron is not a control. Every card starts closed. faq_item_opened once per item per load — a click or a key at once, a mouse hover only after 0.6 s. */
const faqFine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const faqSeen = new Set();
const faqOpen = (item, via) => {
  const slug = item.dataset.item;
  if (!slug || faqSeen.has(slug)) return;
  faqSeen.add(slug);
  track('faq_item_opened', { item: slug, via });
};
for (const item of document.querySelectorAll('.fq')) {
  const btn = item.querySelector('button'), panel = item.querySelector('.fq-a');
  let dwell = 0, hide = 0;
  const openNow = () => item.classList.contains('on') || (faqFine && item.matches(':hover') && !item.classList.contains('shut'));
  const sync = immediate => {
    const open = openNow();
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    clearTimeout(hide);
    if (open) { panel.inert = false; return; }
    /* inert after the close, not during it: setting it on the way down cancels the height transition */
    if (immediate || reduced) { panel.inert = true; return; }
    hide = setTimeout(() => { if (!openNow()) panel.inert = true; }, 620);
  };
  item.addEventListener('pointerenter', e => {
    if (!faqFine || e.pointerType !== 'mouse') return;
    item.classList.remove('shut');
    clearTimeout(dwell);
    dwell = setTimeout(() => faqOpen(item, 'hover'), 600);
    sync();
  });
  item.addEventListener('pointerleave', () => { clearTimeout(dwell); item.classList.remove('shut'); sync(); });
  const toggle = via => {
    clearTimeout(dwell);
    if (item.classList.contains('on')) {
      item.classList.remove('on');
      if (item.matches(':hover')) item.classList.add('shut');
    } else {
      item.classList.remove('shut');
      item.classList.add('on');
      faqOpen(item, via);
    }
    sync();
  };
  btn.addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
    e.preventDefault();   // the click that would follow is detail 0; count this one as a key
    toggle('key');
  });
  item.addEventListener('click', e => {
    if (e.target.closest('a, .chev') || e.detail === 0) return;   // a link follows itself; the marker is not a button
    toggle('click');
  });
  sync(true);
}

/* ───── socials ───── */
for (const [net, url] of Object.entries(SOCIALS)) if (url) {
  const a = el('a', { href: url, 'data-net': net, target: '_blank', rel: 'noopener' }, net.toUpperCase());
  a.addEventListener('click', () => track('social_clicked', { net }));   // a null URL (discord, telegram) adds no button
  $('socials').append(a);
}
for (const a of document.querySelectorAll('a[href="https://x.com/FreightChainSol"], a[href="https://www.youtube.com/@FreightChainGame"]')) {
  if (a.dataset.net) continue;   // FIND US already listened above
  const net = a.href.includes('youtube') ? 'youtube' : 'x';
  a.addEventListener('click', () => track('social_clicked', { net }));
}
document.querySelector('a[href="/blink.html"]')?.addEventListener('click', () => track('blink_link_clicked'));

/* ───── sign-in / CTA ─────
   CONNECT asks the injected wallet (Phantom / Solflare) to sign the server's challenge; the server verifies the ed25519 signature and sets the httpOnly session cookie
   (production: `__Host-fc_session`, host-only on api.<apex> – every page calls the API there). The landing never sees the token: it only asks /api/me who is signed in. */
const btn = $('connect'), msg = $('msg'), playTop = $('play-top'), chip = $('chip-wallet'), chipRides = $('chip-rides');
/* The invite block: a code typed here (or arriving as /?promo=CODE – a shareable invite link) rides along to the lobby profile (#promo, the old tab), where it only pre-fills the field. */
const inviteIn = $('invite-code'), inviteMsg = $('invite-msg');
let invite = (new URLSearchParams(location.search).get('promo') ?? '').trim().slice(0, 64);
const linkCode = invite;   // what the invite link carried (analytics: was the submit the link's own code?)
const codeOf = v => v.replace(/\s+/g, '').toUpperCase().slice(0, 32);   // the same normalising as the server; the code is a marketing string, never a secret of the visitor
if (invite) { inviteIn.value = invite; inviteMsg.textContent = `Code ${invite.toUpperCase()} is ready – connect your wallet to claim it.`; }
const CODE_SHAPE = /^[A-Z0-9_-]{3,32}$/;   // what a promo code looks like – anything else a visitor types is never sent to analytics
const toLobby = () => {
  const code = inviteIn.value.trim() || invite;   // a code typed but never submitted (CONNECT was clicked straight away) is kept too
  flushSoon(); location.href = `${SITE_BASE}/lobby.html${code ? `?promo=${encodeURIComponent(code)}#promo` : ''}`;
};
/* Both click assignments: signed-out runs signIn, signed-in (paintSession) opens the lobby. Classification stays inside signIn. */
const onConnect = async () => {
  if (S.me) { track('lobby_open_clicked', { surface: 'landing' }); toLobby(); return; }
  track('wallet_connect_clicked', { surface: 'landing', wallet_name: walletName() });
  btn.disabled = true; msg.textContent = 'Approve the sign-in message in your wallet…'; msg.className = 'msg';
  try { await signIn(); msg.textContent = 'Signed in – opening the lobby…'; toLobby(); } catch (e) { msg.textContent = e.message; msg.className = 'msg bad'; btn.disabled = false; }
};
function paintSession(me) {
  S.me = me; btn.textContent = 'OPEN THE LOBBY →'; btn.classList.remove('ghost'); btn.onclick = onConnect; playTop.textContent = 'LOBBY';
  const playFree = $('play-free'); if (playFree) playFree.hidden = true;
  chip.textContent = short(me.wallet); chip.title = `signed in: ${me.wallet}`; chip.hidden = false;
  chipRides.textContent = `${me.freeRides} free · ${plural(heldTickets(me.tickets), 'paid ride')}`; chipRides.hidden = false;
  msg.textContent = ''; msg.className = 'msg';
  paintBoards();
}
$('invite').onsubmit = e => {
  e.preventDefault();
  invite = inviteIn.value.trim();
  if (invite) track('promo_invite_submitted', { code: CODE_SHAPE.test(codeOf(invite)) ? codeOf(invite) : null, signed_in: !!S.me, from_link: !!linkCode && codeOf(invite) === codeOf(linkCode) });
  if (!invite) { inviteMsg.textContent = 'Type the code first.'; inviteMsg.className = 'hint bad'; inviteIn.focus(); return; }
  inviteMsg.className = 'hint';
  if (S.me) { toLobby(); return; }
  inviteMsg.textContent = `Code ${invite.toUpperCase()} saved – connect your wallet to claim it.`;
  btn.scrollIntoView({ block: 'center' }); btn.focus();   // the code goes with the sign-in below
};
btn.onclick = onConnect;
playTop.onclick = async () => {
  track('play_top_clicked', { signed_in: !!S.me });
  if (S.me) toLobby();
  else if (isMobileDevice()) {
    const { showMobileToast } = await import('../../client/js/mobile.js');
    showMobileToast({
      liveAction: `${SITE_BASE}/lobby.html#live`,
      replaysAction: `${SITE_BASE}/lobby.html#replays`,
    });
  } else {
    flushSoon();
    location.href = `${GAME_BASE}/play.html?offline=1`;
  }
};
track('landing_viewed', { surface: 'landing' });   // once per load, not on the 10 s refresh, and not after /api/pool
if (linkCode) track('promo_invite_viewed', { code: CODE_SHAPE.test(codeOf(linkCode)) ? codeOf(linkCode) : null });   // an invite link was opened
api('me', undefined, { report: false }).then(me => { track('session_restored', { surface: 'landing', wallet: me.wallet, ...(me.demo ? { is_demo: true } : {}) }); paintSession(me); }, () => {});   // signed in already: no forced redirect – the pool is the point of this page. Anonymous 401 stays a quiet GET.

/* ───── dash cards: the tilt follows the pointer ───── */
for (const card of document.querySelectorAll('.card3d')) {
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
const seenChapter = new Set();
const so = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) {
    nav.forEach(a => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
    if (seenChapter.has(e.target.id)) continue;
    seenChapter.add(e.target.id);
    track('landing_chapter_viewed', { chapter: e.target.id });   // once per section id per load; nav clicks are not a second event
  }
}, { rootMargin: '-40% 0px -55% 0px' });
document.querySelectorAll('section[id]').forEach(s => so.observe(s));

/* ───── boot ───── */
refresh();
api('tiers', undefined, { report: false }).then(paintTiers, () => { $('tiers').replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'dim' }, 'Prices unavailable right now.')))); });
refreshBoard();
setInterval(() => { if (!document.hidden) refresh(); }, 10000);
leaveOnClose(() => `${API_BASE}/api/${livePath('landing')}&leave=1`);
setInterval(() => { if (!document.hidden) refreshBoard(); }, 30000);
setInterval(() => { if (document.hidden) return; $('lb-clock').textContent = new Date(now()).toISOString().slice(11, 19); if (!S.pool) return; const t = left(S.pool.round.endsAt - now()); $('hero-cd').textContent = t; document.querySelectorAll('.pool .cd').forEach(c => { c.textContent = t; }); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
