import { api } from './wallet.js';
import { buyRide, buyTickets, claimRefund, waitPaid, ORDER_SIG } from './pay.js';
import { salesOpen, pendingOrder, reconcileOrder } from './tickets-api.js';
import { escrowExplainer, explorerTx, explorerUrl, rideError, buyError, sol, usd, hasStandings, progressText, ticketShareText, xIntent, shortAddr as short } from './pools.js';
import { poolCard, paidShift, resultCard, escrowSummary, refundRows } from './lobby-pools.js';
import { blockPaid } from './lobby-agreements.js';
import { $, el } from './dom.js';
import { GAME_BASE, SITE_BASE } from '../js/hosts.js';
import { homeBlinkUrl } from '../js/ui/share.js';
import { track, flushSoon } from '../js/analytics.js';
import { store } from '../js/util.js';
import { FREE_COUNTRIES } from '../js/free-countries.js';
import { isMobileDevice, showMobileToast } from '../js/mobile.js';
import { ticketDialog, hideTicketDialog } from './ticket-dialog.js';

/* NEW RIDE tab controller for the Lobby: free ride level picker, pending ride banner,
   ticket order retry, pool cards, pool results, refunds, rules, and Solana Pay QR mount. */

const SHIFT = { '1h': '1H', '4h': '4H', '8h': '8H' };
const paidLine = qty => `Paid – ${qty} ticket${qty === 1 ? '' : 's'} credited.`;
const freeLevels = t => t?.levels ?? [];

function showLobbyMobileToast() {
  showMobileToast({
    liveAction: () => { location.hash = '#live'; },
    replaysAction: () => { location.hash = '#replays'; },
  });
}

export function createNewRideTab({ S, view, now, dur, km, TIER_NAME, refreshMe, refreshPool, creditLocal, tickCountdowns }) {
  const pendingShown = new Set();
  let stBusy = false;

  const pickedLevel = t => { const ls = freeLevels(t); return ls.find(l => l.level === S.opt.level) ?? ls[0] ?? null; };
  const tutorialOn = () => S.opt.tutorial ?? !S.me?.tutorialPassed;
  const tutorialAllowed = t => pickedLevel(t)?.tutorial !== false;
  const assistAllowed = t => pickedLevel(t)?.assist !== false;

  const lockOpt = (id, on, allowed) => {
    const input = $(id), label = input?.closest('.opt'); if (!input || !label) return;
    input.disabled = !allowed; input.checked = !!on && allowed; label.classList.toggle('locked', !allowed);
  };

  function guideBox(id, name, hint, on, set, locked = false) {
    return el('label', { class: `opt${locked ? ' locked' : ''}`, for: id },
      el('input', { type: 'checkbox', id, checked: on && !locked, disabled: !!locked, onchange: e => set(e.target.checked) }),
      el('span', {}, el('b', {}, name), el('small', {}, hint)));
  }

  function syncFreeLevel() {
    const t = S.tiers?.tiers.find(x => x.id === 'free'), lv = pickedLevel(t), card = $('tier-free'); if (!card || !lv) return;
    card.querySelectorAll('.lv').forEach(node => { const input = node.querySelector('input'), on = Number(input.value) === lv.level; node.classList.toggle('on', on); input.checked = on; });
    lockOpt('opt-tutorial', tutorialOn(), tutorialAllowed(t));
    lockOpt('opt-assist', S.opt.assist, assistAllowed(t));
  }

  function levelPicker(t) {
    const ls = freeLevels(t), on = pickedLevel(t); if (!ls.length) return '';
    const pick = n => { S.opt.level = n; store.set('freightchain.level', String(n)); syncFreeLevel(); };
    return el('div', { class: 'levels', role: 'radiogroup', 'aria-label': 'Level' },
      ls.map(l => {
        const c = FREE_COUNTRIES[l.level];
        return el('label', { class: `lv${l.level === on.level ? ' on' : ''}`, for: `level-${l.level}`, ...(c ? { style: `--stripe:${c.stripe}` } : {}) },
          el('input', { type: 'radio', name: 'level', id: `level-${l.level}`, value: String(l.level), checked: l.level === on.level, disabled: !!S.busy, onchange: () => pick(l.level) }),
          c ? el('span', { class: 'cty' }, c.country) : '',
          el('b', {}, l.name),
          c ? el('small', { class: 'where' }, `${c.title} · ${c.place}`) : '',
          c ? el('small', { class: 'desc' }, c.desc) : '',
          el('small', {}, `${dur(l.seconds)} · ≥ ${km(l.completeDist)} km`),
          l.assist ? '' : el('small', { class: 'why' }, 'no assist'));
      }));
  }

  const tierInfo = t => {
    const scale = S.me.demo && t.id !== 'free' ? S.me.demoScale : 1, seconds = t.seconds / scale, dist = t.completeDist / scale;
    return { seconds, dist, scale, name: TIER_NAME[t.id] ?? t.id, shift: `${dur(t.seconds)} · ≥ ${km(t.completeDist)} km`, driven: scale > 1 ? `${dur(seconds)} · ≥ ${km(dist)} km` : '' };
  };

  function tierOff(t) {
    if (S.pending) return 'finish the paid ride waiting for you first';
    if (t.id === 'free') return S.me.freeRides <= 0 && !S.me.readyFreeRide ? 'no free rides left – the next one at 00:00 UTC' : '';
    return t.available ? '' : 'not available right now';
  }

  function adoptReady(free) {
    const r = S.me?.readyFreeRide; if (!r || r.id === S.readyId) return;
    S.readyId = r.id; if (r.level != null) S.opt.level = r.level;
    const lv = freeLevels(free).find(l => l.level === r.level);
    if (lv?.tutorial !== false) S.opt.tutorial = r.tutorial;
    if (lv?.assist !== false) S.opt.assist = r.assist;
  }

  function freeCard(t) {
    const off = tierOff(t), mobile = isMobileDevice();
    const btnLabel = S.busy === 'free' ? 'WORKING…' : mobile ? 'DESKTOP TO DRIVE · WATCH LIVE' : S.me.readyFreeRide ? 'START FREE RIDE · ready' : 'START FREE RIDE';
    return el('article', { class: 'tier free', id: 'tier-free' },
      el('div', { class: 'freeinfo' },
        el('div', { class: 'hd' }, el('span', { class: 'nm' }, TIER_NAME.free)),
        el('div', { class: 'prize' },
          el('span', { class: 'st live' }, 'FREE PLAY'),
          el('span', { class: 'st done' }, 'OFFICIAL LEADERBOARD & ACHIEVEMENTS'),
          mobile ? el('span', { class: 'st live' }, 'DESKTOP TO DRIVE · SPECTATE ON MOBILE') : ''),
        levelPicker(t),
        freeLevels(t).length ? '' : el('span', { class: 'sub', id: 'free-shift' }, tierInfo(t).shift),
        el('div', { class: 'guide' },
          guideBox('opt-tutorial', 'TUTORIAL', S.me?.tutorialPassed ? 'Step-by-step tips over the game – you have done it, switch it on to see it again.' : 'Step-by-step tips over the game: ignition, gears, steering, lights, hull. On for your first ride.', tutorialOn(), v => { S.opt.tutorial = v; }, !tutorialAllowed(t)),
          guideBox('opt-assist', 'ASSIST', 'The truck and the battery last twice as long and every control gets a tip when it matters. Finish a free ride WITHOUT it for the “On My Own” achievement.', S.opt.assist, v => { S.opt.assist = v; store.set('freightchain.assist', v ? '1' : '0'); }, !assistAllowed(t))),
        off ? el('span', { class: 'tag' }, off) : '',
        el('button', { class: 'go', id: 'start', disabled: !!off || !!S.busy, onclick: startFree }, btnLabel)),
      el('p', { class: 'msg dim', id: 'msg-free' }));
  }

  function soonCard(t) {
    const i = tierInfo(t);
    return el('article', { class: 'tier legacy', id: `tier-${t.id}` },
      el('div', { class: 'hd' }, el('span', { class: 'nm' }, i.name), el('span', { class: 'st done' }, 'SOON')),
      el('span', { class: 'pr' }, `$${t.usd}`, el('small', {}, ' · planned')), ...paidShift(i),
      el('span', { class: 'sub more' }, 'Available soon.'),
      el('button', { class: 'go', disabled: true }, 'SOON'),
      el('p', { class: 'msg dim', id: `msg-${t.id}` }));
  }

  function noPoolCard(t) {
    const i = tierInfo(t);
    return el('article', { class: 'tier legacy', id: `tier-${t.id}` },
      el('div', { class: 'hd' }, el('span', { class: 'nm' }, i.name), el('span', { class: 'st done' }, 'NO POOL')), ...paidShift(i),
      el('span', { class: 'sub' }, 'No pool open right now.'),
      el('button', { class: 'go', disabled: true }, 'NEXT POOL SOON'),
      el('p', { class: 'msg dim', id: `msg-${t.id}` }));
  }

  function legacyCard(t) {
    const off = tierOff(t), i = tierInfo(t);
    return el('article', { class: 'tier legacy', id: `tier-${t.id}` },
      el('div', { class: 'hd' }, el('span', { class: 'nm' }, i.name), el('span', { class: 'st done' }, 'PAY PER RIDE')),
      el('span', { class: 'pr' }, `$${t.usd}`, el('small', {}, t.lamports ? ` · ${sol(t.lamports)}` : ' · price unavailable')), ...paidShift(i),
      el('span', { class: 'sub more' }, 'Price locked 10 min after you order. ', el('b', {}, 'Non-refundable'), ': goes to the weekly round (50% grand · 20% top 20 · 20% next week · 10% fees).'),
      off ? el('span', { class: 'tag' }, off) : '',
      el('button', { class: 'go', disabled: !!off || !!S.busy, onclick: () => startLegacy(t.id) }, S.busy === t.id ? 'WORKING…' : [`PAY $${t.usd}${t.lamports ? ` · ${sol(t.lamports)}` : ''}`, el('small', { class: 'go-sub' }, 'LET’S RIDE →')]),
      el('p', { class: 'msg dim', id: `msg-${t.id}` }));
  }

  function setPayQr(key, url) { S.payQr = url ? { key, url } : null; mountPayQr(); }
  async function mountPayQr() {
    const wanted = S.payQr;
    if (!wanted) { $('pay-qr')?.remove(); return; }
    const { payQrBlock } = await import('./qr.js');
    if (S.payQr !== wanted) return;
    const msg = $(`msg-${wanted.key}`); if (!msg?.isConnected) return;
    let holder = $('pay-qr');
    if (!holder) { holder = el('div', { id: 'pay-qr', class: 'pay-qr' }); msg.after(holder); }
    holder.replaceChildren(...payQrBlock(wanted.url));
  }

  function say(key, text, bad = false, link = null) {
    if (text) S.msgs[key] = [text, bad, link]; else delete S.msgs[key];
    const m = $(`msg-${key}`); if (m) { m.replaceChildren(text, link ? el('a', { href: link.href, target: '_blank', rel: 'noopener' }, link.text) : ''); m.className = `msg ${bad ? 'bad' : 'dim'}`; }
  }

  async function busy(key, fn) {
    if (S.busy) return;
    S.busy = key; hideTicketDialog(); for (const k of Object.keys(S.msgs)) say(k, ''); paintTiers();
    try { await fn(); } finally { S.busy = null; if ($('tiers')) paintTiers(); }
  }

  const creditDialog = (poolId, qty, { lamports = 0, signature = null, programId = null } = {}) => {
    const t = S.tiers?.tiers.find(x => x.pool?.id === poolId), p = t?.pool, solUsd = S.tiers?.solUsd, tier = t?.id ?? S.me?.tickets?.find(r => r.poolId === poolId)?.tier;
    const rows = [lamports ? { k: 'paid', v: `${sol(lamports)}${solUsd ? ` ${usd(lamports, solUsd)}` : ''}` } : null,
      { k: 'pool', v: p ? `#${poolId} · ${p.label}` : `#${poolId}` },
      signature ? { k: 'transaction', v: short(signature), href: explorerTx(signature), title: signature } : null,
      p?.address ? { k: 'escrow', v: short(p.address), href: explorerUrl(p.address), title: `pool account ${p.address}` } : null,
      programId ? { k: 'program', v: short(programId), href: explorerUrl(programId), title: `program ${programId}` } : null].filter(Boolean);
    const proof = signature ? explorerTx(signature) : p?.address ? explorerUrl(p.address) : null;
    ticketDialog({ ok: true, shift: SHIFT[tier] ?? '', qty, text: `${paidLine(qty)} Your entry sits in the pool’s vault on chain, not with us.`, detail: p ? progressText(p, now()) : '', rows,
      more: { href: escrowExplainer(), text: 'How the escrow works →' }, share: proof && xIntent(ticketShareText({ shift: TIER_NAME[tier] ?? 'paid', qty, lamports, poolId }), homeBlinkUrl(SITE_BASE, location.origin)) });
  };
  const failDialog = (tier, text) => ticketDialog({ ok: false, shift: SHIFT[tier] ?? '', text });

  function play(r, tier, level = null) {
    if (isMobileDevice()) { showLobbyMobileToast(); return; }
    if (r.tier !== tier) { checkPending(); say(tier, `You already have a ${TIER_NAME[r.tier] ?? r.tier} ride ready – start that one first.`, true); return; }
    if (level != null && r.level != null && r.level !== level) { say(tier, 'The server kept your ride at another level – pick it again or start that one.', true); return; }
    flushSoon(); location.href = `${GAME_BASE}/play.html?ride=${r.id}`;
  }

  const clicked = (id, usdAmt = 0, level = null) => track('ride_buy_clicked', { tier_id: id, is_free: id === 'free', price_usd: usdAmt, is_demo: !!S.me?.demo, level });
  const freeBody = () => { const t = S.tiers?.tiers.find(x => x.id === 'free'), lv = pickedLevel(t); return { tier: 'free', tutorial: tutorialOn() && tutorialAllowed(t), assist: S.opt.assist && assistAllowed(t), ...(lv ? { level: lv.level } : {}) }; };
  const refusedOffer = e => { if (e?.code === 'agreements_required') location.hash = '#profile'; };

  const startFree = () => busy('free', async () => {
    if (isMobileDevice()) {
      showLobbyMobileToast();
      say('free', 'Driving requires a desktop browser with keyboard controls. Check out the LIVE tab to watch streams and replays on mobile!', true);
      return;
    }
    const body = freeBody(); clicked('free', 0, body.level ?? null);
    try { play(await api('rides', body), 'free', body.level ?? null); } catch (e) { say('free', rideError(e, 'free'), true); await refreshMe(); }
  });

  const startLegacy = id => busy(id, async () => {
    if (isMobileDevice()) {
      showLobbyMobileToast();
      say(id, 'Driving requires a desktop browser with keyboard controls. Check out the LIVE tab to watch streams on mobile!', true);
      return;
    }
    if (blockPaid(S.me)) return;
    clicked(id, S.tiers?.tiers.find(t => t.id === id)?.usd ?? 0);
    try { play(await buyRide(id, text => say(id, text), url => setPayQr(id, url)), id); } catch (e) { refusedOffer(e); say(id, rideError(e, id), true); }
  });

  const ride = tier => busy(tier, async () => {
    if (isMobileDevice()) {
      showLobbyMobileToast();
      say(tier, 'Driving requires a desktop browser with keyboard controls. Check out the LIVE tab to watch streams on mobile!', true);
      return;
    }
    if (blockPaid(S.me)) return;
    clicked(tier, S.tiers?.tiers.find(t => t.id === tier)?.usd ?? 0);
    say(tier, 'Spending a ticket…');
    try { play(await api('rides', { tier }), tier); } catch (e) { refusedOffer(e); say(tier, rideError(e, tier), true); await refreshMe(); }
  });

  const buy = (tier, poolId, qty) => busy(tier, async () => {
    if (blockPaid(S.me)) return;
    try {
      const r = await buyTickets(poolId, qty, text => say(tier, text), url => setPayQr(tier, url));
      S.qty[tier] = 1; creditLocal(poolId, qty); await Promise.all([refreshMe(), refreshPool()]);
      const line = paidLine(qty);
      say(tier, line, false, r.order?.signature ? { href: explorerTx(r.order.signature), text: `${r.order.signature.slice(0, 8)}… ↗` } : null);
      creditDialog(poolId, qty, { lamports: r.order?.lamports, signature: r.order?.signature, programId: r.programId });
    } catch (e) { refusedOffer(e); const line = buyError(e); say(tier, line, true); failDialog(tier, line); }
  });

  const refund = (poolId, key) => busy(key, async () => {
    try {
      const { signature: sig, settled } = await claimRefund(poolId, text => say(key, text)); await refreshMe();
      say(key, settled ? 'Refunded – the lamports are back in your wallet: ' : 'Refund sent – the lamports land in your wallet when it confirms: ', false, { href: explorerTx(sig), text: `${sig.slice(0, 8)}… ↗` });
    } catch (e) { say(key, e.notConfigured ? 'Refunds through the lobby are not switched on in this build yet. Once a pool has failed, the program lets ANY wallet send the refund for you – nobody can keep the money.' : buyError(e), true); }
  });

  function paintPool() {
    const box = $('poolbox'), p = S.pool; if (!box) return;
    if (!p || !p.pools?.length) { box.hidden = true; box.style.display = 'none'; return; }
    box.hidden = false; box.style.display = '';
    box.replaceChildren(...escrowSummary(p, now(), salesOpen(S.tiers)));
  }

  function paintPending() {
    const box = $('pendingbox'); if (!box) return;
    const r = S.pending;
    if (r && !pendingShown.has(r.id)) { pendingShown.add(r.id); track('pending_ride_shown', { ride_id: r.id, tier_id: r.tier }); }
    const startIt = () => {
      if (isMobileDevice()) { showLobbyMobileToast(); return; }
      if (r.tier !== 'free' && blockPaid(S.me)) return;
      track('pending_ride_start_clicked', { ride_id: r.id });
      flushSoon(); location.href = `${GAME_BASE}/play.html?ride=${r.id}`;
    };
    box.replaceChildren(r ? el('div', { class: 'note' }, el('span', {}, el('b', {}, `Your paid ${TIER_NAME[r.tier] ?? r.tier} ride is waiting`), S.pendingNote ? ` · ${S.pendingNote}` : ''), el('button', { onclick: startIt }, 'START IT')) : S.pendingNote ? el('p', { class: 'dim' }, S.pendingNote) : '');
  }

  async function checkPending() {
    try {
      let { ride: r } = await api('rides/pending', undefined, { report: false });
      if (r && r.status !== 'created') {
        S.pendingNote = 'Checking for an earlier payment…'; paintPending();
        const rec = await api(`rides/${r.id}/reconcile`, {}); r = rec.status === 'paid' ? rec.ride : null;
        S.pendingNote = r ? 'Your earlier payment was found.' : '';
      }
      S.pending = r?.status === 'created' ? r : null;
    } catch (e) { S.pendingNote = `Could not check for earlier payments (${e.message}).`; }
    paintPending(); paintTiers();
  }

  async function paidTickets(order, paid) {
    creditLocal(order.poolId, order.qty);
    await Promise.all([refreshMe(), refreshPool()]);
    creditDialog(order.poolId, order.qty, { lamports: paid?.lamports ?? order.lamports, signature: paid?.signature ?? null });
  }

  function paintOrder() {
    const box = $('orderbox'), o = S.order; if (!box) return;
    if (!o || o.status === 'paid') { box.replaceChildren(); return; }
    let sig = o.signature; try { sig ??= localStorage.getItem(ORDER_SIG(o.id)); } catch { /* private mode */ }
    const retry = () => busy('order', async () => {
      try {
        const looked = await reconcileOrder(o.id).catch(() => null);
        const r = looked?.status === 'paid' ? looked : (sig ? await waitPaid(o.id, sig) : looked);
        S.order = r?.status === 'paid' ? null : (r?.order ?? o);
        if (r?.status === 'paid') { await paidTickets(o, r.order); return; }
      } catch (e) { const line = buyError(e); say('order', line, true); failDialog(S.tiers?.tiers.find(t => t.pool?.id === o.poolId)?.id, line); }
      paintOrder();
    });
    const head = sig ? `A payment for ${o.qty} ticket${o.qty === 1 ? '' : 's'} is in flight` : `An unfinished order for ${o.qty} ticket${o.qty === 1 ? '' : 's'} – nothing was charged`;
    const tail = sig ? ` · ${sol(o.lamports)} · ${o.status}` : ` · ${sol(o.lamports)} · lapses at ${new Date(o.expiresAt).toUTCString().slice(17, 22)} UTC unless you pay it`;
    box.replaceChildren(el('div', { class: 'note' }, el('span', {}, el('b', {}, head), tail),
      el('button', { disabled: !!S.busy, onclick: retry }, sig ? 'RETRY CONFIRM' : 'CHECK AGAIN'), el('p', { class: 'msg dim', id: 'msg-order' })));
  }

  async function checkOrder() {
    try {
      let order = (await pendingOrder()).order;
      if (order && order.status !== 'paid') {
        const looked = await reconcileOrder(order.id).catch(() => null);
        if (looked?.status === 'paid') { await paidTickets(order, looked.order); order = null; }
        else if (looked?.order) order = looked.order;
      }
      S.order = order && order.status !== 'paid' ? order : null;
    } catch { S.order = null; }
    paintOrder();
  }

  const resultPools = n => { const shown = new Set(S.tiers?.tiers.map(t => t.pool?.id)); return [...(S.pools?.pools ?? []).slice().reverse(), ...(S.pools?.finished ?? [])].filter(p => !shown.has(p.id) && hasStandings(p, n)); };

  async function loadStandings(pools) {
    const t = Date.now(), due = pools.filter(p => { const s = S.standings[p.id]; return !(s?.final && s.ranks.every(r => r.paid)) && t - (S.stAt[p.id] ?? 0) > 14000; });
    if (stBusy || !due.length) return;
    stBusy = true; due.forEach(p => { S.stAt[p.id] = t; });
    await Promise.all(due.map(p => api(`pools/${p.id}/standings`, undefined, { report: false }).then(st => { S.standings[p.id] = st; }, () => { S.standings[p.id] ??= null; })));
    stBusy = false;
    if (S.tab === 'new' && !S.busy) paintTiers();
  }

  function paintResults(ctx) {
    const box = $('results'); if (!box) return;
    const list = resultPools(ctx.now), sched = id => S.tiers?.tiers.find(t => t.id === id)?.schedule ?? null;
    box.replaceChildren(...(list.length ? [el('h2', {}, 'POOL RESULTS'), el('div', { class: 'tiers' }, list.map(p => resultCard(p, S.standings[p.id], { ...ctx, name: id => TIER_NAME[id] ?? id, schedule: sched })))] : []));
    loadStandings([...list, ...(S.tiers?.tiers ?? []).map(t => t.pool).filter(p => p && hasStandings(p, ctx.now))]);
  }

  async function paintRefunds() {
    const box = $('refunds'); if (!box) return;
    const shown = new Set(S.tiers?.tiers.map(t => t.pool?.id)), rows = (S.me.tickets ?? []).filter(t => t.refundable && !shown.has(t.poolId));
    box.replaceChildren(...refundRows(rows, S.poolInfo, S.busy, refund));
    const missing = rows.filter(r => !(r.poolId in S.poolInfo));
    if (!missing.length) return;
    await Promise.all(missing.map(r => api(`pools/${r.poolId}`, undefined, { report: false }).then(d => { S.poolInfo[r.poolId] = d; }, () => { S.poolInfo[r.poolId] = null; })));
    if ($('refunds') === box) box.replaceChildren(...refundRows(rows, S.poolInfo, S.busy, refund));
  }

  function paintRules() {
    const box = $('rules'); if (!box) return;
    box.replaceChildren(el('b', {}, 'CONDITIONS'), el('ul', { class: 'rules' },
      el('li', {}, 'Drive the whole shift: its time ', el('b', {}, 'AND'), ' its distance. Speed is capped at 100 km/h, so idling can’t bank it.'),
      el('li', {}, 'End the shift early, abandon it or crash and it does ', el('b', {}, 'not'), ' count as finished. A ticket is spent when its ride is created.'),
      el('li', {}, 'Pool tickets: your entry sits in the pool’s vault on chain, not with us. A pool that misses its goal refunds every ticket in full; in a live pool the finished shifts rank for its prize share. ', el('a', { href: escrowExplainer(), target: '_blank', rel: 'noopener' }, 'How the escrow works →')),
      el('li', {}, 'The game records your inputs while you drive. After the shift the server checks that recording – complete, consistent with your ride, human-timed – and verified shifts rank for prizes (the leaderboard says when that check is switched on). Flagged shifts wait for a review.'),
      el('li', {}, `Free rides: no fee, no prize. A new wallet starts with a few; the daily refill (+1 at 00:00 UTC) tops you up to ${S.me?.freeRidesMax ?? 5}. A promo or an admin grant can sit above that.`)));
  }

  function paintTiers() {
    const box = $('tiers'), fbox = $('freebox'); if (!box) return;
    if (!S.tiers) { box.replaceChildren(el('p', { class: 'bad' }, 'Could not load the ride list. Reload the page.')); return; }
    const ctx = { me: S.me, solUsd: S.tiers.solUsd, now: now(), busy: S.busy || S.pending, sales: salesOpen(S.tiers), focus: S.focus, act: { ride, buy, refund, qty: (id, n) => { S.qty[id] = n; paintTiers(); } } };
    const free = S.tiers.tiers.find(t => t.id === 'free');
    adoptReady(free);
    fbox.replaceChildren(...(free ? [freeCard(free)] : []));
    box.replaceChildren(...S.tiers.tiers.filter(t => t.id !== 'free').map(t => {
      if (t.pool) return poolCard(t, tierInfo(t), { ...ctx, qty: S.qty[t.id] ?? 1, winners: hasStandings(t.pool, ctx.now) ? S.standings[t.pool.id] : null });
      if (t.onSale === false) return soonCard(t);
      return salesOpen(S.tiers) ? noPoolCard(t) : legacyCard(t);
    }));
    for (const [k, m] of Object.entries(S.msgs)) say(k, ...m);
    mountPayQr();
    paintResults(ctx); paintRefunds(); tickCountdowns?.();
  }

  function renderNew() {
    view.replaceChildren(
      el('div', { class: 'card pool', id: 'poolbox', hidden: true, style: 'display:none' }), el('div', { id: 'pendingbox' }), el('div', { id: 'orderbox' }), el('div', { id: 'refunds' }),
      el('div', { id: 'freebox' }),
      el('h2', {}, 'PAID SHIFTS · COMING SOON'), el('div', { class: 'tiers', id: 'tiers' }), el('div', { id: 'results' }),
      el('div', { class: 'card', id: 'rules', style: 'margin-top:12px' }));
    paintPool(); paintPending(); paintTiers(); paintRules();
    refreshMe();
    if (salesOpen(S.tiers)) checkOrder();
  }

  return { renderNew, paintPool, paintTiers, checkPending, refund };
}
