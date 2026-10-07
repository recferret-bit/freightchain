import { api, signIn } from './wallet.js';

/* Landing: public numbers (pool, tiers, top 5, trucks on the road) + the sign-in button. No session needed to look.
   Everything from the server goes in with textContent, as in the lobby. */
const $ = id => document.getElementById(id);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
const pad = n => String(Math.floor(n)).padStart(2, '0');
const sol = l => `${(l / 1e9).toFixed(l >= 1e9 ? 2 : 3)} SOL`;
const km = m => (m / 1000).toFixed(m < 10_000 ? 2 : 1);
const left = ms => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400); return `${d ? d + 'd ' : ''}${pad((s % 86400) / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`; };
const short = w => `${w.slice(0, 4)}…${w.slice(-4)}`;
const hue = w => { let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const TIER_NAME = { free: 'Test ride', '1h': '1 hour', '4h': '4 hours', '8h': '8 hours' };
const hours = s => (s >= 3600 ? `${s / 3600} h` : `${Math.round(s / 60)} min`);

let pool = null, skew = 0;

function paintPool() {
  const box = $('poolbox');
  if (!pool) { box.replaceChildren(el('span', { class: 'dim' }, 'Prize pool unavailable right now.')); return; }
  const g = pool.usd.grand;
  box.replaceChildren(
    el('div', { class: 'lbl' }, 'GRAND PRIZE · ACCRUED THIS WEEK'),
    el('div', { class: 'big' }, sol(pool.split.grand)),
    el('div', { class: 'usd' }, g != null ? `≈ $${g} at the current price` : ''),
    el('div', { class: 'dim' }, `${pool.entries} paid entr${pool.entries === 1 ? 'y' : 'ies'} · round closes in `, el('b', { id: 'cd' }, left(pool.round.endsAt - (Date.now() + skew)))));
}

function paintTiers(t) {
  const rows = t.tiers.map(x => el('tr', {},
    el('td', {}, TIER_NAME[x.id] ?? x.id),
    el('td', {}, hours(x.seconds)),
    el('td', {}, x.usd ? `$${x.usd}` : 'free'),
    el('td', {}, x.lamports ? sol(x.lamports) : '–')));
  $('tiers').replaceChildren(el('thead', {}, el('tr', {}, ...['SHIFT', 'LENGTH', 'PRICE', 'IN SOL'].map(h => el('th', {}, h)))), el('tbody', {}, rows));
  $('price').textContent = t.solUsd ? `SOL ≈ $${t.solUsd} right now. The price is locked for 10 minutes when you order.` : 'SOL price unavailable right now.';
}

function paintTop(rows) {
  $('top5').replaceChildren(...(rows.length ? rows.slice(0, 5).map(r => el('div', { class: 'r' },
    el('span', { class: 'n' }, `#${r.rank}`), el('span', { class: 'av', style: `background:hsl(${hue(r.wallet)} 60% 50%)` }), short(r.wallet),
    el('span', { class: 'd' }, `${km(r.distance)} km · ${r.rides} ride${r.rides === 1 ? '' : 's'}`))) : [el('span', { class: 'dim' }, 'No finished paid shift yet this week. Be the first.')]));
}

async function refresh() {
  const [p, l] = await Promise.all([api('pool').catch(() => null), api('live').catch(() => null)]);
  if (p) { pool = p; paintPool(); }
  if (l) { skew = l.now - Date.now(); $('chip-live').textContent = `${l.rides.length} on the road`; }
}

const btn = $('connect'), msg = $('msg');
btn.onclick = async () => {
  btn.disabled = true; msg.textContent = 'Approve the sign-in message in your wallet…'; msg.className = 'msg dim';
  try { await signIn(); location.href = '/lobby.html'; } catch (e) { msg.textContent = e.message; msg.className = 'msg bad'; btn.disabled = false; }
};
api('me').then(() => { btn.textContent = 'OPEN THE LOBBY →'; btn.onclick = () => { location.href = '/lobby.html'; }; }, () => {});   // signed in already: no forced redirect, the pool is the point of this page

await refresh();
api('tiers').then(paintTiers, () => { $('tiers').replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'dim' }, 'Prices unavailable right now.')))); });
api('leaderboard?board=round').then(j => paintTop(j.rows), () => paintTop([]));
setInterval(() => { if (!document.hidden) refresh(); }, 15000);
setInterval(() => { const c = $('cd'); if (c && pool) c.textContent = left(pool.round.endsAt - (Date.now() + skew)); }, 1000);
