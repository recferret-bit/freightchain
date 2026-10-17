import { TOKEN_SYMBOL } from '../config.js';
import { watch, addEvent, LIVE_LAG } from '../watch.js';
import { EFFECT_INFO, solText } from '../live-effects.js';
import { el } from '../../site/dom.js';
import { api, signIn } from '../../site/wallet.js';
import { phoneStep, signAndSend } from '../../site/pay.js';
import { solanaPayUrl, donationPayPath } from '../../site/solana-pay.js';
import { API_BASE } from '../hosts.js';

/* Spectator interaction & donation service for watch-panel.js: wallet sign-in, chat messages, TEN4 burns (HONK, day/night, snow/clear), and mock/Solana-Pay donations. */

const HONK_GAP_MS = 10_000, TIME_GAP_MS = 20_000;
const FX_IDS = ['w-honk-day', 'w-honk-night', 'w-honk-snow', 'w-honk-clear'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sent = (effect, how) => (effect === 'tip' ? `Tip sent (${how}).` : `${EFFECT_INFO[effect].label} sent (${how}) – it happens when the driver's game picks it up; you see it here ~${LIVE_LAG} s later.`);

export const donationKey = rideId => `freightchain.donation.${rideId}`;
export const rememberDonation = (rideId, orderId) => { try { sessionStorage.setItem(donationKey(rideId), orderId); } catch { /* private mode */ } };
export const forgetDonation = rideId => { try { sessionStorage.removeItem(donationKey(rideId)); } catch { /* private mode */ } };

export async function resumeDonation(addOwn = addEvent) {
  if (watch.features?.payment !== 'chain' || !watch.id) return;
  let orderId = null; try { orderId = sessionStorage.getItem(donationKey(watch.id)); } catch { return; }
  if (!orderId) return;
  const r = await api(`watch/${encodeURIComponent(watch.id)}/donation-orders/${orderId}/reconcile`, {}).catch(() => null);
  if (r?.status !== 'paid') return;
  forgetDonation(watch.id);
  if (!watch.events.has(r.event.id)) addOwn(r.event);
}

export function createWatchActions({ P, $, say, refreshMe, paintMe, addOwn = addEvent }) {
  async function connect() {
    P.busy = true; paintMe();
    try { await signIn(); await refreshMe(); } catch (e) { P.busy = false; paintMe(); say(e.message, 'bad'); return; }
    P.busy = false;
  }

  async function send() {
    const t = $('w-text'); if (!t || !t.value.trim()) return;
    try { const e = await api(`watch/${encodeURIComponent(watch.id)}/messages`, { text: t.value }); t.value = ''; say(''); addOwn(e); }
    catch (e) { say(e.message, 'bad'); if (e.status === 401) refreshMe(); }
  }

  async function honkSignature(amount) {
    const me = await api('honk', undefined, { report: false }).catch(() => null);
    const programId = me?.chain?.programId;
    if (!programId || !P.me?.wallet) return null;
    const { signHonkBurn } = await import('../../site/honk-sign.js');
    return signHonkBurn({ programId, owner: P.me.wallet, amount });
  }

  function releaseHonk() {
    const b = $('w-honk'); if (b && Date.now() >= P.honkUntil) b.disabled = false;
  }

  async function sendHonk() {
    const b = $('w-honk');
    if (!b || b.disabled || Date.now() < P.honkUntil) return;
    b.disabled = true;
    try {
      const signature = await honkSignature(1n * 1_000_000n);
      await api(`watch/${encodeURIComponent(watch.id)}/honk`, signature ? { signature } : {}, { method: 'POST' });
      P.honkUntil = Date.now() + HONK_GAP_MS;
      say('Burn landed.', 'good');
      setTimeout(releaseHonk, HONK_GAP_MS);
    } catch (e) {
      if (Date.now() >= P.honkUntil) b.disabled = false;
      say(e.message, 'bad');
      if (e.status === 401) refreshMe();
    }
  }

  function honkBtn() {
    const left = P.honkUntil - Date.now();
    const b = el('button', { id: 'w-honk', type: 'button', disabled: left > 0, title: `Burn 1 ${TOKEN_SYMBOL} to HONK. It shows up in the chat. Nothing happens to the truck.`, onclick: sendHonk }, 'HONK');
    if (left > 0) setTimeout(releaseHonk, left);
    return b;
  }

  function releaseTime() {
    if (Date.now() < P.timeUntil) return;
    for (const id of FX_IDS) { const b = $(id); if (b) b.disabled = false; }
  }

  function holdFx() {
    const buttons = FX_IDS.map((id) => $(id));
    if (buttons.some((b) => !b || b.disabled) || Date.now() < P.timeUntil) return false;
    for (const b of buttons) b.disabled = true;
    return true;
  }

  async function sendHonkFx(cost, path, body, msg) {
    if (watch.ride?.ranked || !holdFx()) return;
    try {
      const signature = await honkSignature(cost * 1_000_000n);
      await api(`watch/${encodeURIComponent(watch.id)}/honk/${path}`, { ...body, ...(signature ? { signature } : {}) });
      P.timeUntil = Date.now() + TIME_GAP_MS;
      say(msg, 'good');
      setTimeout(releaseTime, TIME_GAP_MS);
    } catch (e) {
      if (Date.now() >= P.timeUntil) releaseTime();
      say(e.message, 'bad');
      if (e.status === 401) refreshMe();
    }
  }

  const sendTime = phase => sendHonkFx(10n, 'time', { phase }, phase === 'night' ? 'Night burn landed.' : 'Day burn landed.');
  const sendWeather = weather => sendHonkFx(25n, 'weather', { weather }, weather === 'snow' ? 'Snow burn landed.' : 'Clear burn landed.');

  function timeControls() {
    const left = P.timeUntil - Date.now(), held = left > 0;
    const title = on => `Burning 10 ${TOKEN_SYMBOL} turns the ride to ${on}. The driver's clock moves; spectators see it in the replay.`;
    const btn = (phase, label) => el('button', { id: `w-honk-${phase}`, type: 'button', class: 'alt', disabled: held, title: title(phase), onclick: () => sendTime(phase) }, label, el('small', {}, `10 ${TOKEN_SYMBOL}`));
    const wxTitle = on => `Burning 25 ${TOKEN_SYMBOL} ${on === 'snow' ? 'makes it snow' : 'clears the snow'}. Not a donation.`;
    const wx = (weather, label) => el('button', { id: `w-honk-${weather}`, type: 'button', class: 'alt', disabled: held, title: wxTitle(weather), onclick: () => sendWeather(weather) }, label, el('small', {}, `25 ${TOKEN_SYMBOL}`));
    if (held) setTimeout(releaseTime, left);
    return [el('div', { class: 'w-fx' }, btn('day', 'DAY'), btn('night', 'NIGHT')), el('div', { class: 'w-fx' }, wx('snow', 'SNOW'), wx('clear', 'CLEAR'))];
  }

  async function showDonationQr(url) {
    if (!url) { $('w-qr')?.remove(); return; }
    const { payQrBlock } = await import('../../site/qr.js');
    const msg = $('w-msg'); if (!msg?.isConnected) return;
    let box = $('w-qr');
    if (!box) { box = el('div', { id: 'w-qr', class: 'pay-qr' }); msg.before(box); }
    box.replaceChildren(...payQrBlock(url, 'dim w-small'));
  }

  async function donate(effect) {
    if (P.busy) return;
    const n = $('w-note-in'), note = n?.value.trim() || null, id = encodeURIComponent(watch.id);
    const finishPaid = ev => { forgetDonation(watch.id); if (n) n.value = ''; addOwn(ev); say(ev.effect === effect ? sent(effect, 'paid') : `Paid – ${ev.text ?? 'delivered as a tip'}.`, 'good'); };
    P.busy = true;
    const stop = { done: false };
    try {
      if (watch.features.payment !== 'chain') {
        addOwn(await api(`watch/${id}/donations`, { effect, note })); say(sent(effect, 'mock'), 'good');
      } else {
        say('Preparing the transfer…');
        const { order, transaction } = await api(`watch/${id}/donation-orders`, { effect, note });
        rememberDonation(watch.id, order.id);
        await showDonationQr(solanaPayUrl(API_BASE, location.origin, donationPayPath(order.id)));
        const phone = async () => {
          const end = Date.now() + 90000;
          while (!stop.done && Date.now() < end) {
            const r = await api(`watch/${id}/donation-orders/${order.id}/reconcile`, {}).catch(() => null);
            if (r?.status === 'paid') return r;
            await sleep(3000);
          }
          return null;
        };
        let signature;
        try {
          say(`Approve ${solText(order.lamports)} (devnet) to the driver in your wallet…`);
          signature = await signAndSend(transaction.transaction);
        } catch (e) {
          say(e?.code === 'no_wallet' ? 'No browser wallet. Scan the code with the phone wallet that holds this account (devnet)…' : phoneStep(e));
          const found = await phone();
          if (found?.status === 'paid') { finishPaid(found.event); return; }
          throw e;
        }
        say('Sent – waiting for the network to confirm…');
        const phonePaid = phone();
        for (let i = 0; i < 60; i++) {
          const r = await Promise.race([
            api(`watch/${id}/donation-orders/${order.id}/confirm`, { signature }),
            phonePaid.then(hit => hit ?? new Promise(() => {})),
          ]);
          if (r.status === 'paid') { finishPaid(r.event); return; }
          await sleep(1500);
        }
        const late = await phonePaid;
        if (late?.status === 'paid') { finishPaid(late.event); return; }
        say('The network has not confirmed it yet – it appears in the feed once it does (reload to check).', 'dim');
      }
      if (n) n.value = '';
    } catch (e) { say(e.message, 'bad'); if (e.status === 401) refreshMe(); }
    finally { stop.done = true; P.busy = false; $('w-qr')?.remove(); }
  }

  return { connect, send, honkBtn, timeControls, donate };
}
