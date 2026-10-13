import { CFG } from '../config.js';
import { st } from '../state.js';
import { online } from '../online.js';
import { toast } from './toast.js';
import { setNight } from '../world/daynight.js';
import { placeHole, obstacleSpot } from '../world/holes.js';
import { roadObjects, AHEAD, CH } from '../world/chunks.js';
import { net, laneLat } from '../net/network.js';
import { EFFECT_INFO, short, solText, advanceCursor } from '../live-effects.js';
import { api as siteApi } from '../../site/wallet.js';
import { store } from '../util.js';

/* Live streams, the DRIVER's side (online rides only): poll the ride's inbox (what spectators sent – server/src/application/use-cases/live), show the chat on
   the CB panel, apply the paid effects (night / day / an obstacle ahead) and stamp each one back – where an obstacle went is what every replay puts there.
   No WebSockets: one GET every POLL_MS. Offline nothing here runs. */
const POLL_MS = 4000, CB_LINES = 4, CB_TTL = 25_000;
const feed = { on: false, cursor: 0, seen: new Set(), pending: [], timer: 0, viewers: 0, totals: null, features: null, muted: new Set(), hidden: store.get('freightchain.cb') === 'hidden', box: null, lines: null, head: null };

const api = (path, body) => siteApi(path, body, { timeoutMs: 8000, report: false });   // chat, donations and effects are not analytics; a failed poll must not become api_request_failed

export function startLiveFeed() {
  if (!online.ride || feed.on) return;
  feed.on = true; mountCB();
  const tick = async () => { if (online.done) { stopLiveFeed(); return; } await poll().catch(() => { /* next time */ }); applyPending(); feed.timer = setTimeout(tick, POLL_MS); };
  feed.timer = setTimeout(tick, 1000);
}
export function stopLiveFeed() { feed.on = false; clearTimeout(feed.timer); if (feed.box) feed.box.hidden = true; }

async function poll() {
  const j = await api(`rides/${online.ride.id}/inbox?after=${feed.cursor}`);
  feed.viewers = j.viewers; feed.totals = j.totals; feed.features = j.features ?? feed.features; feed.muted = new Set(j.muted ?? []);
  for (const e of j.events) {
    if (feed.seen.has(e.id)) continue;
    feed.seen.add(e.id);
    if (feed.muted.has(e.wallet) && e.kind === 'message') continue;
    if (e.kind === 'message') cb(short(e.wallet), e.text, '', e.wallet);
    else {
      const fx = EFFECT_INFO[e.effect] ?? { label: e.effect, icon: '💰', says: 'donated' };
      cb(short(e.wallet), `${fx.icon} ${fx.says} · ${solText(e.lamports)}${feed.features?.payment === 'chain' ? '' : ' (mock)'}${e.text ? ` – “${e.text}”` : ''}`, 'gift', e.wallet);
      if (e.effect !== 'tip' && !e.applied) feed.pending.push({ e, stamp: null });
    }
  }
  feed.cursor = advanceCursor(feed.cursor, j.events, j.now);
  paintHead();
}

/* effects wait while the game is paused (or the menu is up) and go on the moment the driver is back on the road */
function applyPending() {
  if (st.mode !== 'drive') return;
  const drop = p => { const i = feed.pending.indexOf(p); if (i >= 0) feed.pending.splice(i, 1); };
  for (const p of [...feed.pending]) {
    if (p.sending) continue;
    p.stamp ??= apply(p.e) ?? missed(p.e);   // computed ONCE: a re-sent stamp is the same stamp (the server keeps the first anyway)
    p.sending = true;
    api(`rides/${online.ride.id}/effects/${p.e.id}/applied`, p.stamp)
      .then(() => drop(p), err => { if (err.status && err.status < 500 && err.status !== 429) drop(p); })   // 4xx: nothing to retry; network / 5xx: next tick
      .finally(() => { p.sending = false; });
  }
}

/* nothing could be done (no room for an obstacle within 40 chunks, an effect this build does not know): stamp it as missed, so spectators stop waiting */
function missed(e) {
  toast(`${EFFECT_INFO[e.effect]?.icon ?? '·'} ${short(e.wallet)}'s ${EFFECT_INFO[e.effect]?.label ?? e.effect} found no room on the road – it fizzled`, 3000);
  return { t: st.t, s: st.s, lat: null, missed: true };
}
/* → the stamp { t, s, lat } or null (nothing could be done) */
function apply(e) {
  const fx = EFFECT_INFO[e.effect], who = short(e.wallet);
  if (e.effect === 'night' || e.effect === 'day') {
    setNight(e.effect === 'night', false, true);   // a paid effect (the server's event): fades, bypasses the clock lock
    toast(`${fx.icon} ${who} ${fx.says}`, 3500);
    return { t: st.t, s: st.s, lat: null };
  }
  if (!fx?.hole) return null;
  /* beyond the built chunks (AHEAD) and the warning sign's distance, so it never pops into view: it streams in like any hole, sign first */
  const at = obstacleSpot(st.s + AHEAD + CFG.HOLE_WARN + CH);
  if (at === null) return null;
  const n = net.lanes(at, 1), lane = Math.max(0, Math.min(n - 1, Math.round((st.d - 2.4) / 4.2)));   // the lane the truck is in now (own side)
  const lat = laneLat(1, lane), ci = placeHole(fx.hole, at, lat, `live${e.id}`);
  roadObjects.rebuild(ci);   // a no-op unless that stretch is already built
  toast(`${fx.icon} ${who} ${fx.says} – ${((at - st.s) / 1000).toFixed(1)} km ahead, in your lane`, 5000);
  return { t: st.t, s: at, lat };
}

/* the CB panel: the last few lines from the spectators + how many are watching (server text only through textContent) */
/* chat safety for the driver: K (or a click on the header) folds the panel away – remembered – and every spectator line has a MUTE button: that wallet's
   lines vanish from every feed and it can't post on this ride any more (POST /api/rides/:id/mutes). #cb lets clicks through except on those two. */
function mountCB() {
  if (feed.box) { feed.box.hidden = false; return; }
  feed.box = document.createElement('div'); feed.box.id = 'cb'; feed.box.setAttribute('aria-live', 'polite');
  feed.head = document.createElement('button'); feed.head.className = 'cb-head'; feed.head.type = 'button'; feed.head.title = 'fold / unfold the CB (K)';
  feed.head.addEventListener('click', toggleCB); feed.head.addEventListener('keydown', e => e.preventDefault());   // Space / Enter belong to the truck
  feed.lines = document.createElement('div'); feed.lines.className = 'cb-lines';
  feed.box.append(feed.head, feed.lines); document.body.append(feed.box); paintHead();
}
export function toggleCB() { feed.hidden = !feed.hidden; store.set('freightchain.cb', feed.hidden ? 'hidden' : 'shown'); paintHead(); feed.head?.blur(); }
addEventListener('keydown', e => { if (e.code === 'KeyK' && feed.on && !e.repeat && !e.target.closest?.('input, textarea')) toggleCB(); });
function paintHead() {
  if (!feed.head) return;
  const t = feed.totals, f = feed.features, quiet = f && !f.chat && !f.donations;
  feed.box.classList.toggle('folded', feed.hidden);
  feed.head.textContent = `CB ${feed.hidden ? '▸' : '▾'} · 👁 ${feed.viewers} watching${t && (t.messages || t.donations) ? ` · ${t.messages} msg · ${solText(t.lamports)}${f?.payment === 'chain' ? '' : ' (mock)'}` : ''}${quiet ? ' · spectators can\'t write on this ride' : ''}${feed.hidden ? ' · K' : ''}`;
}
function cb(who, text, cls = '', wallet = '') {
  if (!feed.lines) return;
  const line = document.createElement('div'); line.className = `cb-line ${cls}`; line.dataset.wallet = wallet;
  const name = document.createElement('b'); name.textContent = `${who}: `;
  line.append(name, document.createTextNode(text));
  if (wallet) { const m = document.createElement('button'); m.type = 'button'; m.className = 'cb-mute'; m.textContent = 'mute'; m.title = `mute ${who} on this ride`; m.addEventListener('click', () => mute(wallet, who)); line.append(m); }
  feed.lines.append(line);
  while (feed.lines.children.length > CB_LINES) feed.lines.firstChild.remove();
  setTimeout(() => line.classList.add('old'), CB_TTL);
}
async function mute(wallet, who) {
  try {
    await api(`rides/${online.ride.id}/mutes`, { wallet, muted: true });
    feed.muted.add(wallet);
    for (const l of [...feed.lines.children]) if (l.dataset.wallet === wallet && !l.classList.contains('gift')) l.remove();
    toast(`Muted ${who} on this ride`, 1800);
  } catch (e) { toast(`Could not mute: ${e.message}`, 2500); }
}
export const liveFeed = feed;   // debug / e2e: __game.liveFeed
