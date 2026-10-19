import '../../client/js/crash-boot.js';   // before the rest of this page: a throw while it loads is still reported
import { api, prepareSignIn, signIn, walletName } from '../../client/site/wallet.js';   // one sign-in implementation for landing + lobby (Vite bundles it; fs.allow in vite.config.js for dev)
import { API_BASE, GAME_BASE, PITCHDECK_BASE, SITE_BASE, STORYBOOK_BASE, WHITEPAPER_BASE } from '../../client/js/hosts.js';   // '' on localhost; in production the game is on ride.<apex>, NOT the landing's host, and SITE_BASE is the apex
import { track, flushSoon } from '../../client/js/analytics.js';
import { reportWebVitals } from '../../client/js/web-vitals.js';
import { livePath, leaveOnClose } from '../../client/site/presence.js';   // this page counts as online in the live feed – and leaves it when closed
import { left, short, plural } from './format.js';
import { heldTickets, escrowExplainer, poolPhase } from '../../client/site/pools.js';   // the lobby's pool wording, so both pages say the same thing
import { $, el, bindCard3d, bindScrollSpy, bindReveal, bindShotRotator, observeOnce, guardMobilePlay } from '../../client/site/effects.js';
import { paintHero, paintPool, paintTiers, paintPools, paintWinners, paintBoards, buildTickerNodes, bindChainCards } from './boards.js';
import { bindAnchors } from './anchor.js';
import { store } from '../../client/js/util.js';

bindAnchors();   // before the chapter observer, so a #faq load is already on the heading it highlights

/* Landing: seven chapters (ride · loop · economy · roadmap · market · about · faq), fed by the public API only – no session needed to look.
   Everything from the server goes in with textContent (other riders' wallets are rendered here). */
reportWebVitals('landing');   // before the first track(), so the leave flush includes the final metrics

const DEMO_VIDEO = '/media/demo.mp4';
const SOCIALS = { x: 'https://x.com/FreightChainSol', youtube: 'https://www.youtube.com/@FreightChainGame', discord: null, telegram: null };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const S = { pool: null, live: null, board: null, skew: 0, me: null };
let poolCds = [], tickerKey = '';
const now = () => Date.now() + S.skew;
const watchUrl = id => `${GAME_BASE}/play.html?watch=${encodeURIComponent(id)}`;

function paintTicker() {
  const { key, nodes } = buildTickerNodes(S, watchUrl);
  if (key === tickerKey) return;   // a fresh DOM restarts the loop; the 20 s refresh would rewind it
  tickerKey = key;
  const tk = $('ticker');
  tk.replaceChildren(...nodes, ...nodes.map(n => n.cloneNode(true)));   // doubled so one half-width translate loops seamlessly
  const shift = tk.scrollWidth / 2;   // px, not -50%: iOS uses the screen width for a % translate of this absolute strip
  if (shift > 1) { tk.style.setProperty('--shift', `-${Math.round(shift)}px`); tk.style.animationDuration = `${(shift / 110).toFixed(1)}s`; }
}

async function refreshWinners() {
  const l = await api('pools', undefined, { report: false }).catch(() => null), box = $('winners');
  const p = l && (l.pools.filter(x => /^(review|payout)$/.test(poolPhase(x, now()))).pop() ?? l.finished[0]);
  const st = p && await api(`pools/${p.id}/standings`, undefined, { report: false }).catch(() => null);
  paintWinners(box, st, SITE_BASE);
}

async function refresh() {
  const [p, l, h] = await Promise.all([api('pool', undefined, { report: false }).catch(() => null), api(livePath('landing'), undefined, { report: false }).catch(() => null),
    api('replays?limit=8', undefined, { report: false }).catch(() => null)]);
  if (p) S.pool = p;
  if (h) S.replays = h.rows;
  if (l) { S.live = l; S.skew = l.now - Date.now(); }
  paintHero(S, now, reduced); poolCds = paintPool(S, now); paintPools(S, now); paintBoards(S, now, watchUrl); paintTicker();
}
async function refreshBoard() { refreshWinners(); S.board = await api('leaderboard?board=round', undefined, { report: false }).catch(() => null); paintBoards(S, now, watchUrl); }

/* ───── hero video: never on the critical path ───── */
const heroVideo = $('hero-video');
function moreSlides() {
  const box = $('slides');
  if (box.children.length > 1) return;
  for (const src of ['/media/hero-poster.webp', '/media/night.webp']) box.append(el('img', { width: '1280', height: '633', decoding: 'async', alt: '', src }));
}
function loadHeroVideo() {
  const src = heroVideo.dataset.src;
  if (!src || reduced || navigator.connection?.saveData) { moreSlides(); return; }
  heroVideo.muted = true; heroVideo.playsInline = true; heroVideo.autoplay = true;
  heroVideo.addEventListener('playing', () => { track('hero_video_started'); const slides = $('slides'); slides.classList.add('off'); for (const img of slides.children) img.style.animation = 'none'; }, { once: true });
  heroVideo.addEventListener('error', () => { track('hero_video_failed'); heroVideo.removeAttribute('src'); moreSlides(); }, { once: true });
  heroVideo.src = src; heroVideo.play().catch(() => {});
}
const whenIdle = window.requestIdleCallback ?? (f => setTimeout(f, 1200));
if (document.readyState === 'complete') whenIdle(loadHeroVideo, { timeout: 4000 }); else addEventListener('load', () => whenIdle(loadHeroVideo, { timeout: 4000 }), { once: true });

bindShotRotator('.deck-shot img', 4000, reduced);

/* ───── demo dialog ───── */
(() => {
  const dlg = $('demo'), box = $('demo-frame');
  $('demo-btn').onclick = () => {
    track('demo_dialog_opened', { has_video: DEMO_VIDEO != null });
    if (DEMO_VIDEO) {
      const v = el('video', { src: DEMO_VIDEO, controls: '', autoplay: '', playsinline: '', preload: 'auto', 'aria-label': 'Freight Chain demo' });
      v.addEventListener('error', () => $('demo-note').textContent = 'The demo video could not be loaded – try again later.');
      box.replaceChildren(v);
      $('demo-note').textContent = 'Devnet demo.';
    } else {
      const practice = el('a', { href: `${GAME_BASE}/play.html` }, 'Play the EASY ride');
      practice.addEventListener('click', e => guardMobilePlay(e, { siteBase: SITE_BASE, onMobile: () => dlg.close() }, () => { track('offline_practice_clicked'); flushSoon(); }));
      $('demo-note').replaceChildren('The demo video is not here yet. ', practice, ' – the real EASY ride, then connect a Solana wallet.');
    }
    dlg.showModal();
  };
  const close = () => { box.replaceChildren(); dlg.close(); };
  $('demo-x').onclick = close; dlg.onclick = e => { if (e.target === dlg) close(); }; dlg.addEventListener('cancel', () => box.replaceChildren());
})();

/* ───── links to the game & split hosts ───── */
for (const a of document.querySelectorAll('a[href="/play.html"]')) {
  a.href = `${GAME_BASE}/play.html`;
  a.addEventListener('click', e => guardMobilePlay(e, { siteBase: SITE_BASE }, () => { track('offline_practice_clicked'); flushSoon(); }));
}
$('storybook-link').href = STORYBOOK_BASE || '/viewer.html';
$('whitepaper-link').href = $('whitepaper-cta').href = WHITEPAPER_BASE || '/whitepaper.html';
for (const id of ['pitchdeck-band', 'pitchdeck-link']) {
  const a = $(id);
  a.href = PITCHDECK_BASE || '/pitchdeck.html';
  a.addEventListener('click', () => { track('pitchdeck_link_clicked', { surface: 'landing' }); flushSoon(); });
}
$('storybook-link').addEventListener('click', () => track('storybook_link_clicked'));
$('escrow-link').href = escrowExplainer();
for (const a of document.querySelectorAll('a[href^="https://whitepaper.freightchain.fun/#"]')) a.href = `${WHITEPAPER_BASE ? `${WHITEPAPER_BASE}/` : '/whitepaper.html'}${a.hash}`;

/* ───── UNDER THE HOOD cards ───── */
bindChainCards(reduced, card => track('chain_card_flipped', { card }));

/* ───── FAQ ───── */
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
    e.preventDefault();
    toggle('key');
  });
  item.addEventListener('click', e => {
    if (e.target.closest('a, .chev') || e.detail === 0) return;
    toggle('click');
  });
  sync(true);
}

/* ───── socials ───── */
for (const [net, url] of Object.entries(SOCIALS)) if (url) {
  const a = el('a', { href: url, 'data-net': net, target: '_blank', rel: 'noopener' }, net.toUpperCase());
  a.addEventListener('click', () => track('social_clicked', { net }));
  $('socials').append(a);
}
for (const a of document.querySelectorAll('a[href="https://x.com/FreightChainSol"], a[href="https://www.youtube.com/@FreightChainGame"]')) {
  if (a.dataset.net) continue;
  const net = a.href.includes('youtube') ? 'youtube' : 'x';
  a.addEventListener('click', () => track('social_clicked', { net }));
}
document.querySelector('a[href="/blink.html"]')?.addEventListener('click', () => track('blink_link_clicked'));

/* ───── sign-in / CTA ───── */
const btn = $('connect'), msg = $('msg'), playTop = $('play-top'), chip = $('chip-wallet'), chipRides = $('chip-rides');
const inviteIn = $('invite-code'), inviteMsg = $('invite-msg');
const referrals = import('../../client/site/referral.js').then(ref => {
  ref.captureRef(store, location.search);
  const next = ref.searchWithoutRef(location.search);
  if (next != null) history.replaceState(null, '', `${location.pathname}${next}${location.hash}`);
  return ref;
});
let invite = (new URLSearchParams(location.search).get('promo') ?? '').trim().slice(0, 64);
const linkCode = invite;
const codeOf = v => v.replace(/\s+/g, '').toUpperCase().slice(0, 32);
if (invite) { inviteIn.value = invite; inviteMsg.textContent = `Code ${invite.toUpperCase()} is ready – connect your wallet to claim it.`; }
const CODE_SHAPE = /^[A-Z0-9_-]{3,32}$/;
const toLobby = async () => {
  await referrals;
  const code = inviteIn.value.trim() || invite;
  flushSoon(); location.href = `${SITE_BASE}/lobby.html${code ? `?promo=${encodeURIComponent(code)}#promo` : ''}`;
};
const pairCode = new URLSearchParams(location.search).get('pair');
const pairOk = /^[0-9a-f]{32}$/.test(pairCode ?? '');
const onConnect = async () => {
  if (S.me && !pairOk) { track('lobby_open_clicked', { surface: 'landing' }); toLobby(); return; }
  track('wallet_connect_clicked', { surface: 'landing', wallet_name: walletName() });
  btn.disabled = true; msg.textContent = 'Approve the sign-in message in your wallet…'; msg.className = 'msg';
  try {
    await signIn();
    if (pairOk) { await api(`auth/pair/${pairCode}/claim`, {}); msg.textContent = 'This computer is signed in. You can put the phone down.'; btn.disabled = false; return; }
    msg.textContent = 'Signed in – opening the lobby…'; toLobby();
  } catch (e) { msg.textContent = e.message; msg.className = 'msg bad'; btn.disabled = false; }
};
function paintSession(me) {
  S.me = me; btn.textContent = 'OPEN THE LOBBY →'; btn.classList.remove('ghost'); btn.onclick = onConnect; playTop.textContent = 'LOBBY';
  const playFree = $('play-free'); if (playFree) playFree.hidden = true;
  chip.textContent = short(me.wallet); chip.title = `signed in: ${me.wallet}`; chip.hidden = false;
  const live = (me.weeklyTickets ?? []).filter(t => !t.rideId && t.expiresAt > Date.now());
  const weekly = live.length ? ` · weekly ${live.map(t => t.tier).join(' ')}` : '';
  chipRides.textContent = `training${weekly} · ${plural(heldTickets(me.tickets), 'paid ride')}`; chipRides.hidden = false;
  msg.textContent = ''; msg.className = 'msg';
  paintBoards(S, now, watchUrl);
}
$('invite').onsubmit = e => {
  e.preventDefault();
  invite = inviteIn.value.trim();
  if (invite) track('promo_invite_submitted', { code: CODE_SHAPE.test(codeOf(invite)) ? codeOf(invite) : null, signed_in: !!S.me, from_link: !!linkCode && codeOf(invite) === codeOf(linkCode) });
  if (!invite) { inviteMsg.textContent = 'Type the code first.'; inviteMsg.className = 'hint bad'; inviteIn.focus(); return; }
  inviteMsg.className = 'hint';
  if (S.me) { toLobby(); return; }
  inviteMsg.textContent = `Code ${invite.toUpperCase()} saved – connect your wallet to claim it.`;
  btn.scrollIntoView({ block: 'center' }); btn.focus();
};
btn.onclick = onConnect;
btn.addEventListener('pointerdown', () => { if (!S.me || pairOk) prepareSignIn(); });
prepareSignIn();
if (pairOk) { msg.textContent = 'Sign in here to approve the computer that showed this code.'; msg.className = 'msg'; }
playTop.onclick = e => {
  track('play_top_clicked', { signed_in: !!S.me });
  if (S.me) toLobby();
  else guardMobilePlay(e, { siteBase: SITE_BASE }, () => { flushSoon(); location.href = `${GAME_BASE}/play.html`; });
};
track('landing_viewed', { surface: 'landing' });
if (linkCode) track('promo_invite_viewed', { code: CODE_SHAPE.test(codeOf(linkCode)) ? codeOf(linkCode) : null });
api('me', undefined, { report: false }).then(me => { track('session_restored', { surface: 'landing', wallet: me.wallet, ...(me.demo ? { is_demo: true } : {}) }); paintSession(me); referrals.then(ref => ref.bindStoredRef(api, store)).catch(() => {}); }, () => {});

/* ───── dash cards + scroll reveal + section highlight ───── */
bindCard3d(document.querySelectorAll('.card3d'), 11, reduced);
const liveCards = [...document.querySelectorAll('.card3d[data-live]')];
if (liveCards.length) {
  observeOnce($('cards'), () => {
    import('./dash-live.js').then(m => m.startLiveDash(liveCards, null, { lazy: true })).catch(e => console.warn('live dash cards unavailable', e));
  }, '120px');
}
bindReveal();
const seenChapter = new Set();
bindScrollSpy(document.querySelectorAll('.nav a'), {
  rootMargin: '-40% 0px -55% 0px',
  onSection: id => { if (!seenChapter.has(id)) { seenChapter.add(id); track('landing_chapter_viewed', { chapter: id }); } },
});

/* ───── boot ───── */
refresh();
api('tiers', undefined, { report: false }).then(paintTiers, () => { $('tiers').replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'dim' }, 'Prices unavailable right now.')))); });
refreshBoard();
setInterval(() => { if (!document.hidden) refresh(); }, 20000);
leaveOnClose(() => `${API_BASE}/api/${livePath('landing')}&leave=1`);
setInterval(() => { if (!document.hidden) refreshBoard(); }, 30000);
setInterval(() => { if (document.hidden) return; $('lb-clock').textContent = new Date(now()).toISOString().slice(11, 19); if (!S.pool) return; const t = left(S.pool.round.endsAt - now()); $('hero-cd').textContent = t; for (const c of poolCds) c.textContent = t; }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
