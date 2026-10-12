import { CFG } from '../config.js';
import { st } from '../state.js';
import { online } from '../online.js';
import { toast } from './toast.js';
import { api as siteApi } from '../../site/wallet.js';
import { explorerUrl, explorerTx, shortAddr, sol } from '../../site/pools.js';
import { checkSeal, pledgeEstimate, pledgeSol } from '../seal.js';

/* ON CHAIN, the driver's side of a TICKET ride (online.ride.poolId set; free rides, guests, replays and the headless test see nothing):
   1. the road seal (js/seal.js) – checked in the browser on the START and the end panel, and shown while driving;
   2. the pool now – prize share, riders, the leader's and this wallet's VERIFIED km (the standings rank verified rides only – this ride's km is the dash's TRIP, never added in);
   3. pledges on this ride – a toast when one locks, and what they would pay at the km driven so far (paid only after the review – an estimate).
   Polls, no sockets; every server string goes in through textContent. */
const km = m => `${(m / 1000).toFixed(1)} km`;

const chain = { on: false, seal: null, sealv: null, pool: null, standings: null, me: null, pledges: [], polled: false, seen: new Set(), timers: [], box: null, rows: null };

/** the ride's seal check (seal.js), cached: it never changes. null = not a pool ride / a pool from before the seal */
export const rideSeal = () => (chain.seal ??= checkSeal(online.ride));

/** paint every `.seal` element of the menu / end panel (they are rebuilt with innerHTML, so this is called after each paint) */
export async function paintSeal() {
  const els = typeof document === 'undefined' ? [] : [...document.querySelectorAll('.seal')];
  if (!els.length) return;
  const s = await rideSeal(), pool = await poolOnce();
  for (const el of els) {
    if (!s) { el.textContent = `pool #${online.ride.poolId} · opened before road seals (program v3)`; continue; }
    el.textContent = s.ok ? `sealed on chain ✓ · pool #${online.ride.poolId} · slot ${s.slot}` : `✗ seal does not match (${s.why})`;
    el.className = `seal ${s.ok ? 'good' : 'bad'}`;
    el.title = s.ok ? 'This road\'s seed is the first 4 bytes of SHA-256(pool id ‖ slot hash ‖ slot) – committed by the escrow program when the pool opened. Your browser re-hashed it just now.' : '';
    if (pool?.address) el.append(link(explorerUrl(pool.address), 'pool account ↗', 'the pool account on the Solana explorer (devnet) – its seed_commitment field'));
  }
}

let poolReq = null;
const api = path => siteApi(path, undefined, { timeoutMs: 8000, report: false });
const poolOnce = () => (online.ride?.poolId == null ? Promise.resolve(null) : chain.pool ? Promise.resolve(chain.pool) : (poolReq ??= api(`pools/${online.ride.poolId}`).then(p => (chain.pool = p), () => { poolReq = null; return null; })));

export function startCabChain() {
  if (!online.ride || online.ride.poolId == null || chain.on || typeof document === 'undefined') return;
  chain.on = true; mount();
  api('me').then(m => { chain.me = m.wallet; paint(); }, () => { /* no highlight */ });
  const pool = async () => {
    const id = online.ride.poolId;
    [chain.pool, chain.standings] = await Promise.all([api(`pools/${id}`).catch(() => chain.pool), api(`pools/${id}/standings`).catch(() => chain.standings)]);
    paint();
  };
  const pledges = async () => {
    const list = await api(`rides/${encodeURIComponent(online.ride.id)}/pledges`).catch(() => null);
    if (!list) return;
    for (const p of list) if (p.status === 'active' && !chain.seen.has(p.id)) {
      chain.seen.add(p.id);
      if (chain.polled) toast(`🔒 ${shortAddr(p.sponsor)} locked ${pledgeSol(p.lamportsPerKm)}/km for you on chain (up to ${p.targetKm} km)`, 5000);   // not the ones locked before START: the row shows them, and the first toast is the controls hint
    }
    chain.pledges = list; chain.polled = true; paint();
  };
  const every = (fn, ms) => { fn(); chain.timers.push(setInterval(() => { if (online.done) stopCabChain(); else fn(); }, ms)); };
  every(pool, CFG.CHAIN_POOL_POLL_MS); every(pledges, CFG.CHAIN_PLEDGE_POLL_MS);
  chain.timers.push(setInterval(paint, 1000));   // the km-driven parts move every second; no request
  rideSeal().then(v => { chain.sealv = v; paint(); });
}
export function stopCabChain() { chain.on = false; chain.timers.forEach(clearInterval); chain.timers = []; if (chain.box) chain.box.hidden = true; }

function link(href, text, title) { const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text; a.title = title; return a; }
function mount() {
  if (chain.box) { chain.box.hidden = false; return; }
  chain.box = document.createElement('div'); chain.box.id = 'chain'; chain.box.setAttribute('aria-label', 'on chain');
  chain.rows = [0, 1, 2].map(() => { const d = document.createElement('div'); d.className = 'ch-row'; chain.box.append(d); return d; });
  document.body.append(chain.box);
}
function paint() {
  if (!chain.box || !chain.on) return;
  const r = online.ride, p = chain.pool, s = chain.standings;
  chain.box.hidden = st.mode !== 'drive';   // the menu / pause / end panels cover the cab anyway
  /* 1 · pool + seal */
  const [head, pot, pl] = chain.rows;
  head.replaceChildren(Object.assign(document.createElement('b'), { textContent: `ON CHAIN · POOL #${r.poolId}` }), ' ');
  if (p?.address) head.append(link(explorerUrl(p.address), '↗', 'the pool account on the Solana explorer (devnet)'), ' ');
  const seal = chain.sealv;
  if (seal) {
    const t = document.createElement('span'); t.className = seal.ok ? 'good' : 'bad';
    t.textContent = seal.ok ? `· ROAD SEALED ${seal.commitment.slice(0, 4)}…${seal.commitment.slice(-4)} ✓` : '· SEAL MISMATCH ✗';
    t.title = seal.ok ? `seed ${r.seed} = the first 4 bytes of the commitment the program wrote at slot ${seal.slot} – re-hashed in your browser` : seal.why;
    head.append(t);
  }
  /* 2 · the pool now */
  const lead = s?.ranks?.[0], mine = s?.ranks?.find(x => x.wallet === chain.me);
  pot.textContent = !p ? 'reading the pool…' : [
    s ? `PRIZES ${sol(s.prizeLamports)}` : `POT ${sol(p.potLamports)}`, `${p.buyers} rider${p.buyers === 1 ? '' : 's'}`,
    lead ? `LEADER ${km(lead.distance)}${lead.wallet === chain.me ? ' (you)' : ''}` : 'no verified ride yet',
    mine && lead?.wallet !== chain.me ? `YOU #${mine.rank} · ${km(mine.distance)}` : '',
  ].filter(Boolean).join(' · ');
  /* 3 · pledges */
  const active = chain.pledges.filter(x => x.status === 'active');
  if (!active.length) pl.textContent = 'PLEDGES none yet – spectators can lock SOL per km for you';
  else {
    const rate = active.reduce((a, x) => a + Number(x.lamportsPerKm), 0);
    pl.textContent = `PLEDGES ${active.length} · ${pledgeSol(rate)}/km · ≈ ${pledgeSol(pledgeEstimate(active, st.s))} so far, paid if verified`;
    const last = active.find(x => x.createSignature);
    if (last) pl.append(' ', link(explorerTx(last.createSignature), '↗', 'the newest pledge\'s lock transaction (devnet)'));
  }
}

export const cabChain = chain;   // debug / e2e: __game.cabChain
