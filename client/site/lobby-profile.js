import { api } from './wallet.js';
import { promoError, promoOk, rideError, sol, shortAddr as short } from './pools.js';
import { profileTickets } from './lobby-pools.js';
import { careerTiles } from './lobby-career.js';
import { agreementsCard } from './lobby-agreements.js';
import { redemptionList } from './lobby-promo.js';
import { referralSection } from './lobby-referral.js';
import { $, el } from './dom.js';
import { SITE_BASE } from '../js/hosts.js';
import { TOKEN_SYMBOL } from '../js/config.js';
import { isMobileDevice, showMobileToast } from '../js/mobile.js';
import { track } from '../js/analytics.js';
import { formatDriver, seedSns } from './sns.js';

/* PROFILE tab controller for the Lobby: legal agreements, driver identity,
   career statistics, active/closed tickets, promo code redemption, referrals, and recent ride history. */

const REVIEW = { under_review: ['UNDER REVIEW', 'warn'], accepted: ['ACCEPTED', 'good'], rejected: ['REJECTED', 'bad'] };
const rideCheck = r => r.review ? el('b', { class: REVIEW[r.review]?.[1] ?? 'warn', title: 'paid rides are reviewed before prizes are paid' }, ` · ${REVIEW[r.review]?.[0] ?? String(r.review).toUpperCase()}`)
  : r.verdict ? el('b', { class: r.verdict === 'verified' ? 'good' : 'bad', title: 'recording check – only verified shifts rank' }, ` · ${r.verdict.toUpperCase()}`) : '';

export function createProfileTab({ S, view, getSeq, bumpMeGen, paintHeader, refreshMe, refund, play, km, avatar, ROUTES, TIER_NAME }) {
  async function startPromoRide(tier) {
    if (isMobileDevice()) { showMobileToast({ liveAction: () => { location.hash = '#live'; }, replaysAction: () => { location.hash = '#replays'; } }); return; }
    try { play(await api('rides', { tier }), tier); } catch (e) { const m = $('promo-msg'); if (m) { m.textContent = rideError(e, tier); m.className = 'msg bad'; } }
  }

  async function paintPromoLists() {
    const my = getSeq(), mine = await api('promo/mine', undefined, { report: false }).catch(e => e);
    if (my !== getSeq()) return;
    const codes = $('mycodes'); if (!codes) return;
    if (mine instanceof Error) { codes.replaceChildren(el('p', { class: 'bad' }, `Could not load your codes (${mine.message}).`)); return; }
    const grants = Array.isArray(mine.grants) ? mine.grants : [];
    codes.replaceChildren(
      ...grants.map(g => el('p', {}, el('button', { type: 'button', id: `promo-start-${g.tier}`, onclick: () => startPromoRide(g.tier) }, `Start free ${g.tier} ride`), el('span', { class: 'dim' }, ` from ${g.code}. Not a purchase, and it does not mint ${TOKEN_SYMBOL}.`))),
      redemptionList(mine.redemptions));
  }

  async function redeem(e) {
    e.preventDefault();
    const input = $('promo-code'), go = $('promo-go'), code = input.value.trim(), m = $('promo-msg');
    const show = (text, cls) => { m.textContent = text; m.className = `msg ${cls}`; };
    if (!code) { show('Type a promo code first.', 'bad'); return; }
    track('promo_redeem_clicked', { surface: 'profile', prefilled: !!S.invited && code.replace(/\s+/g, '').toUpperCase() === S.invited }); S.invited = null;
    go.disabled = true; show('Redeeming…', 'dim');
    try {
      const r = await api('promo/redeem', { code }); input.value = ''; show(promoOk(r), 'good'); if (r.kind === 'tickets' || r.kind === 'ride') S.focus = r.tier;
      await refreshMe();
      S.garage = null;
      if (S.tab === 'profile') await paintPromoLists();
    } catch (err) { show(promoError(err), 'bad'); } finally { go.disabled = false; }
  }

  function promoSection() {
    const input = el('input', { id: 'promo-code', name: 'code', autocapitalize: 'characters', spellcheck: 'false', maxlength: 64, placeholder: 'PROMO CODE', 'aria-label': 'promo code', 'aria-describedby': 'promo-msg' });
    if (S.invite) { input.value = S.invite; S.invited = S.invite.replace(/\s+/g, '').toUpperCase(); S.invite = null; setTimeout(() => input.focus()); }
    paintPromoLists();
    return [el('h2', {}, 'PROMO CODES'),
      el('form', { class: 'promo-form', id: 'promo', autocomplete: 'off', onsubmit: redeem }, input, el('button', { id: 'promo-go', type: 'submit' }, 'REDEEM'), el('p', { class: 'msg dim', id: 'promo-msg', role: 'status' })),
      el('p', { class: 'dim' }, `A ride code gives one 1h, 4h or 8h shift, free of charge. It is not sold and it does not mint ${TOKEN_SYMBOL}. Pool tickets are a separate grant. Cab parts are minted by burning ${TOKEN_SYMBOL} in the `, el('a', { href: '#garage' }, 'garage →')),
      el('div', { id: 'mycodes' }, el('p', { class: 'dim' }, 'Loading…'))];
  }

  async function renderProfile() {
    view.replaceChildren(el('p', { class: 'dim' }, 'Loading…'));
    let p; const my = getSeq();
    try { p = await api('profile', undefined, { report: false }); } catch (e) { if (my === getSeq()) view.replaceChildren(el('p', { class: 'bad' }, e.message)); return; }
    if (my !== getSeq()) return;
    if (p.sns) { S.me.sns = p.sns; seedSns(p.wallet, p.sns); }
    bumpMeGen(); Object.assign(S.me, { freeRides: p.freeRides, freeRidesMax: p.freeRidesMax, nextFreeRideAt: p.nextFreeRideAt, tickets: p.tickets, agreements: p.agreements }); paintHeader();
    const card = agreementsCard(S.me);
    view.replaceChildren(
      el('section', { class: 'prof-sec ch prof-identity' },
        ...(card ? [card] : []),
        el('div', { class: 'who', style: 'display:flex;gap:12px;align-items:center' }, avatar(p.wallet), el('div', {}, el('b', { title: p.wallet }, formatDriver(p.wallet, p.sns)), el('div', { class: 'dim' }, `rider since ${new Date(p.createdAt).toLocaleDateString()}`)))),
      el('section', { class: 'prof-sec ch' }, ...careerTiles(p.career, p.stats, { km, sol })),
      el('section', { class: 'prof-sec ch' }, ...profileTickets(p, S.busy, refund)),
      el('section', { class: 'prof-sec ch' }, ...promoSection()),
      el('section', { class: 'prof-sec ch' }, ...referralSection({ api, short, base: SITE_BASE, origin: location.origin, alive: () => my === getSeq() })),
      el('section', { class: 'prof-sec ch' },
        el('h2', {}, 'RECENT RIDES'),
        p.recent.length ? el('div', { class: 'hist' }, p.recent.map(r => el('div', { class: 'hrow' },
          el('span', {}, new Date(r.startedAt).toLocaleString(), ' · ', TIER_NAME[r.tier] ?? r.tier, r.route ? ` · ${ROUTES[r.route] ?? ''}` : ''),
          el('span', {}, `${km(r.distance)} km · `, el('b', { class: r.status === 'completed' ? 'good' : 'bad' }, r.status.toUpperCase()), rideCheck(r)),
          r.review === 'under_review' ? el('span', { class: 'dim rnote' }, 'An admin checks this ride before prizes are paid.') : ''))) : el('div', { class: 'card empty' }, 'No rides yet – start one!')));
  }

  return { renderProfile };
}
