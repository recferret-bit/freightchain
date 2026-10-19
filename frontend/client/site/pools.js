/* Escrowed prize pools as the lobby and the landing show them (docs/spec/pool.md). PURE: no DOM, no fetch – unit-tested by landing/test/pools.test.js.
   Inputs are the server's DTOs: PrizePoolDto (/api/pools, /api/tiers[].pool), TicketBalanceDto (/api/me.tickets), RFC 9457 problems (Error with .status/.code). Lamports and epoch ms. */

import { WHITEPAPER_BASE } from '../js/hosts.js';
import { ticketShareText as ticketSentence, xIntent } from '../js/ui/share.js';

export { xIntent };

/** The cluster the pools live on (explorer links). '' = mainnet-beta (no query parameter). */
export const CLUSTER = 'devnet';
/** The escrow program (`declare_id!` in programs/freightchain_pools/src/lib.rs) and the cluster's PUBLIC RPC: the game reads a pool account straight from the
    chain with it (ui/cab-chain.js – the road seal), so that check does not rest on our server. Change both with CLUSTER. */
export const POOL_PROGRAM = '8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p';
export const publicRpc = (cluster = CLUSTER) => `https://api.${cluster || 'mainnet-beta'}.solana.com`;
export const explorerUrl = (address, cluster = CLUSTER) => `https://explorer.solana.com/address/${encodeURIComponent(address)}${cluster ? `?cluster=${cluster}` : ''}`;
export const explorerTx = (signature, cluster = CLUSTER) => `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${cluster ? `?cluster=${cluster}` : ''}`;
/** The one public escrow explainer: whitepaper chapter 05. On a split host that is whitepaper.<apex>; elsewhere /whitepaper.html. */
export const escrowExplainer = () => `${WHITEPAPER_BASE || '/whitepaper.html'}#onchain`;

export const shortAddr = a => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a ?? '');   // THE wallet / account shortener: the lobby, admin, the game's live streams and the landing (format.js `short`) all use it
export const sol = l => `${(l / 1e9).toFixed(l >= 1e9 ? 2 : 3)} SOL`;
export const usd = (l, solUsd) => (solUsd ? `≈ $${((l / 1e9) * solUsd).toFixed(2)}` : '');
export const pct = bps => `${+(bps / 100).toFixed(2)}%`;
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const pad = n => String(Math.floor(n)).padStart(2, '0');
export const left = ms => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400); return `${d ? d + 'd ' : ''}${pad((s % 86400) / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`; };
export const day = ms => new Date(ms).toISOString().slice(0, 10);   // UTC date, the same for every viewer
export const hhmm = ms => `${new Date(ms).toISOString().slice(11, 16)} UTC`;

export const STATUS_CLS = { active: 'live', open: 'open', refunding: 'fail', settled: 'done', cancelled: 'done' };

/* ── the daily series: SALE + new rides (until prepDeadline) → shifts on the road finish (until playDeadline) → REVIEW (until payoutAt) → the payout job pays the verified top 20 ── */
/** The pool's phase – mirrors Pool.phase (server/src/domain/economy/pool.entity.ts), in the same order. */
export function poolPhase(p, now) {
  if (p.status === 'settled' || p.status === 'cancelled') return 'closed';
  if (p.status === 'refunding') return 'failed';
  if (now < p.prepDeadline) return 'selling';
  if (p.status === 'open') return 'failed';
  if (now < p.playDeadline) return 'riding';
  return now < (p.payoutAt ?? p.playDeadline) ? 'review' : 'payout';
}
/** A coarse "time left": 3 d · 31 h · 1 h 20 m · 7 m (the phase lines; the exact HH:MM:SS countdown is `left`). */
export const span = ms => { const m = Math.max(1, Math.ceil(ms / 60000)), h = Math.floor(m / 60); return h >= 48 ? `${Math.floor(h / 24)} d` : h >= 10 ? `${h} h` : h ? `${h} h${m % 60 ? ` ${m % 60} m` : ''}` : `${m} m`; };
const PAYOUT_HEAD = { paid: 'PAID', paying: 'PAYING WINNERS', committed: 'WINNERS FIXED · PAID SOON', held: 'PAYOUT ON HOLD', waiting_review: 'PAYOUT WAITS FOR REVIEW', no_winners: 'NO WINNERS', error: 'PAYOUT DELAYED' };
/** The phase as one line: { phase, cls, head, at, pre, post } – the page writes `head · pre<countdown to at>post`; `text` is the same line now (tests, the landing). cls = live / open / fail / done. */
export function phaseLine(p, now) {
  const ph = poolPhase(p, now), st = p.payout?.held ? 'held' : p.payout?.state;
  const r = ph === 'selling' ? { cls: 'open', head: 'ON SALE', at: p.prepDeadline, pre: '', post: ' left' }
    : ph === 'riding' ? { cls: 'live', head: 'FINISHING', at: p.playDeadline, pre: 'no new rides · ', post: ' left' }
      : ph === 'review' ? { cls: 'open', head: 'IN REVIEW', at: p.payoutAt, pre: 'winners paid in ', post: '' }
        : ph === 'payout' ? { cls: st === 'paid' ? 'done' : st === 'error' || st === 'held' ? 'fail' : 'live', head: PAYOUT_HEAD[st] ?? 'PAYING WINNERS' }
          : ph === 'failed' ? { cls: 'fail', head: p.status === 'refunding' ? 'REFUNDING' : 'MISSED ITS GOAL' }
            : { cls: 'done', head: p.status === 'cancelled' ? 'CANCELLED' : st === 'paid' ? 'PAID' : st === 'no_winners' ? 'NO WINNERS' : 'CLOSED' };
  return { phase: ph, at: null, pre: '', post: '', ...r, text: r.at ? `${r.head} · ${r.pre}${span(r.at - now)}${r.post}` : r.head };
}
/** What the payout job says, as a sentence ('' = nothing to say). `underReview` comes from the standings (PoolStandingsDto), not from the pool. */
export function payoutText(payout, underReview) {
  if (!payout) return '';
  if (payout.held) return `ON HOLD – an admin is checking${payout.note ? ` (${payout.note})` : ''}`;
  if (payout.state === 'waiting_review') return underReview ? `${plural(underReview, 'ride')} still under review – the payout waits for every one` : 'waiting for rides under review';
  if (payout.state === 'no_winners') return 'no verified finisher – nothing to pay; the prize share goes back with the close';
  if (payout.state === 'error') return 'payout delayed – it is retried automatically';
  if (payout.state === 'committed') return 'the winners are fixed on chain – public for the review, then paid';
  if (payout.state === 'paying') return 'paying the winners now';
  if (payout.state === 'paid') return 'every winner paid';
  return '';
}
/** The series rule: from the tier's schedule (GET /api/tiers) – or, without it, what the pool's own timestamps say (no sale length there). */
export const poolSchedule = p => ({ saleHours: null, playHours: Math.round((p.playDeadline - p.prepDeadline) / 36e5), reviewHours: Math.round(((p.payoutAt ?? p.playDeadline) - p.playDeadline) / 36e5) });
export const scheduleText = s => [s.saleHours && `a new pool every ${s.saleHours} h · sales and new rides close after ${s.saleHours} h`, s.playHours && `${s.playHours} h to finish`, s.reviewHours && `${s.reviewHours} h review before prizes`].filter(Boolean).join(' · ');
/** Whether a pool has a winners list worth showing: rides counting or over, or a settled pool (not while selling, not a failed / cancelled one). */
export const hasStandings = (p, now) => { const ph = poolPhase(p, now); return ph === 'riding' || ph === 'review' || ph === 'payout' || (ph === 'closed' && p.status === 'settled'); };
/** Status chip: { text, cls } – cls is one of live / open / fail / done. `now` = server-corrected epoch ms. */
export function statusChip(p, now) {
  if (p.status === 'active') return now < p.playDeadline ? { text: 'LIVE', cls: 'live' } : now < (p.payoutAt ?? 0) ? { text: 'IN REVIEW', cls: 'open' } : { text: 'PAYOUT', cls: 'live' };
  if (p.status === 'open') return now >= p.prepDeadline ? { text: 'MISSED ITS GOAL', cls: 'fail' } : { text: `NEEDS ${p.toGo} MORE`, cls: 'open' };
  if (p.status === 'refunding') return { text: 'FAILED – REFUND', cls: 'fail' };
  if (p.status === 'settled') return { text: 'SETTLED', cls: 'done' };
  return { text: p.status.toUpperCase(), cls: 'done' };
}

/** The progress line under the bar: "7 / 10 committed" + what it means. */
export function progressText(p, now) {
  const head = `${p.sold} / ${p.minTickets} committed`;
  if (p.status === 'active') return now < p.playDeadline ? `${head} · live – rides count` : `${head} · rides are over`;
  if (p.status === 'open') return now >= p.prepDeadline ? `${head} · missed its goal – refunds follow` : `${head} · needs ${plural(p.toGo, 'more rider')} to go live`;
  if (p.status === 'refunding') return `${head} · failed – every ticket is refunded in full`;
  return head;
}

/** The deadline that matters now: { label, at } (at = epoch ms, null = none). */
export function deadline(p, now) {
  if (p.status === 'open') return now >= p.prepDeadline ? { label: 'goal deadline passed', at: null } : { label: `goes live if ${p.minTickets} commit by ${day(p.prepDeadline)} · `, at: p.prepDeadline };
  if (p.status === 'active') return now >= p.playDeadline ? { label: 'play window closed – settling', at: null }
    : now < p.prepDeadline ? { label: `new rides until ${day(p.prepDeadline)} · closes in `, at: p.prepDeadline } : { label: `no new rides – shifts finish by ${day(p.playDeadline)} · `, at: p.playDeadline };
  return { label: '', at: null };
}

/** The split as three parts (bps from the pool, never hard-coded). */
export const splitParts = p => [
  { cls: 's-prize', bps: p.split.prizeBps, label: 'prizes' },
  { cls: 's-seed', bps: p.split.seedBps, label: 'seeds the next pool' },
  { cls: 's-fees', bps: p.split.feeBps, label: 'fees' },
];

/** The rules copy on a pool card (§2.8). */
export const rulesText = p => `Your entry sits in the pool’s vault on chain – not with us. If fewer than ${p.minTickets} riders commit by ${day(p.prepDeadline)}, every ticket is refunded in full. Live pool: ${pct(p.split.prizeBps)} prizes, ${pct(p.split.seedBps)} seeds the next pool, ${pct(p.split.feeBps)} fees.`;

/** An unused ticket POST /api/rides can spend now: a live pool before its last start (`rideBy` – the sale end: no new rides after it; checked against this clock too – the list may be minutes old). */
export const canRide = (t, now) => t.status === 'active' && t.ridable !== false && !(t.rideBy <= now);

/** What a wallet holds for one tier, across every pool of it (pools overlap). `ridable` = unused tickets that can be ridden now, `rideBy` = the soonest of their
    deadlines, `closed` = unused tickets of live pools whose rides are over (spent on nothing). */
export function tierTickets(tickets, tier, now = Date.now()) {
  const rows = (tickets ?? []).filter(t => t.tier === tier), live = rows.filter(t => canRide(t, now) && t.balance > 0);
  return {
    rows, ridable: live.reduce((a, t) => a + t.balance, 0), rideBy: live.length ? Math.min(...live.map(t => t.rideBy ?? Infinity)) : null,
    closed: rows.filter(t => t.status === 'active' && t.balance > 0 && !canRide(t, now)), waiting: rows.filter(t => t.status === 'open').reduce((a, t) => a + t.balance, 0), refundable: rows.filter(t => t.refundable),
  };
}

/** Every unused ticket the wallet can ride with right now (all tiers). */
export const ridableTickets = (tickets, now = Date.now()) => (tickets ?? []).filter(t => canRide(t, now)).reduce((a, t) => a + t.balance, 0);

/** Unused tickets the wallet holds: a live pool, or an open one that is still filling. A failed pool has already voided its balance. */
export const heldTickets = (tickets, now = Date.now()) => (tickets ?? []).filter(t => t.status === 'open' || canRide(t, now)).reduce((a, t) => a + t.balance, 0);   // an expired ticket (rides closed) is not held

/** The lobby header. The count is every ticket held; a pool that is still filling is called out so the number is not read as "ride now". */
export function paidChip(tickets, now = Date.now()) {
  const n = heldTickets(tickets, now);
  const wait = (tickets ?? []).filter(t => t.status === 'open').reduce((a, t) => a + t.balance, 0);
  const label = `${n} paid ride ticket${n === 1 ? '' : 's'}`;
  return wait > 0 && wait < n ? `${label} · ${wait} waiting` : wait > 0 ? `${label} · waiting` : label;
}

/** How many more tickets this wallet may buy into the pool (the cap counts what it ever bought, like the program does). */
export const buyRoom = (p, held) => Math.max(0, p.maxPerWallet - (held?.bought ?? 0));

/** The one primary action of a pooled tier card: { kind: ride|wait|refund|buy|none, text }. */
export function cardAction(p, tt, now) {
  if (tt.ridable > 0) return { kind: 'ride', text: `RIDE (${tt.ridable} left)` };
  if (tt.refundable.length) return { kind: 'refund', text: 'CLAIM REFUND' };
  if (p?.status === 'open' && tt.waiting > 0) return now >= p.prepDeadline ? { kind: 'none', text: 'GOAL MISSED – REFUND SOON' } : { kind: 'wait', text: `WAITING FOR ${plural(p.toGo, 'MORE RIDER', 'MORE RIDERS')}` };
  return { kind: 'buy', text: 'BUY A TICKET TO RIDE' };
}

const TIER_NAME = { '1h': '1 HOUR', '4h': '4 HOURS', '8h': '8 HOURS' };
const tierName = t => TIER_NAME[t] ?? t;

/** A readable sentence for every refusal of POST /api/rides (409 codes of the ledger; the server's detail carries the numbers). */
export function rideError(e, tier) {
  if (e?.code === 'agreements_required') return 'Accept the 18+ and loss offer on your profile before a paid shift.';
  if (e?.code === 'no_tickets') return `No ${tierName(tier)} tickets left – buy one or redeem a promo code.`;
  if (e?.code === 'assist_not_allowed') return `${e.message[0]?.toUpperCase() ?? ''}${e.message.slice(1)} – untick ASSIST or pick an easier level.`;
  if (e?.code === 'tutorial_not_allowed') return `${e.message[0]?.toUpperCase() ?? ''}${e.message.slice(1)} – untick TUTORIAL or pick an easier level.`;
  if (e?.code === 'rides_closed') return `Rides for your ${tierName(tier)} ticket are over (${e.message.replace(/T(\d\d:\d\d):\d\d\.\d+Z$/, ' $1 UTC')}). A ticket counts only in its own pool – buy one in the pool on sale now.`;
  if (e?.code === 'pool_not_live') return `The pool is still waiting for riders (${e.message}). Your tickets wait – and are refunded in full if it misses its goal.`;
  if (e?.status === 409 && /in progress/.test(e.message ?? '')) return 'You already have a ride on the road (another tab?). It frees up about 2½ minutes after its last signal.';
  return e?.message ?? String(e);
}

/** …and of POST /api/promo/redeem (404 unknown; 409 promo_unavailable / no_open_pool / ticket_cap / already_owned – the details are already sentences). */
export function promoError(e) {
  if (e?.status === 404) return 'Unknown promo code – check the spelling.';
  if (e?.code === 'promo_unavailable') return `This code can’t be used: ${e.message}.`;
  if (e?.code === 'no_open_pool') return `No pool to put these tickets in: ${e.message}.`;
  if (e?.code === 'ticket_cap') return `Wallet cap reached: ${e.message}.`;
  if (e?.code === 'already_owned') return 'You already own this item – the code was not used up.';
  if (e?.status === 400) return 'Type a promo code first.';
  return e?.message ?? String(e);
}
/** What a redemption did, as one sentence. A ride code is not a purchase and does not mint TEN4. */
export function promoOk(r) {
  if (r.kind === 'ride') return `One free ${r.tier} ride (${r.code}). It is not for sale. Start it from your profile. It does not mint TEN4.`;
  if (r.kind === 'free_rides') return `+${plural(r.added, 'free ride')} (${r.code}) · you now have ${r.freeRides}`;
  if (r.kind === 'cosmetic') return `Unlocked ${r.label} (${r.code}) – it is on your truck now. Pick parts in the GARAGE.`;
  return `+${plural(r.added, 'ticket')} (${r.code}) in pool #${r.poolId} · you hold ${r.balance} · cap ${r.cap}${r.added === 0 ? ' – you are at the cap, nothing added' : ''}`;
}

/** The 𝕏 post after a ticket buy: `shift` = the tier's name (1 HOUR…), lamports = what the order paid (0 = unknown). The intent url is the site home (a blink), not the explorer receipt – that stays in the dialog. t.co counts the url as 23. */
export const ticketShareText = ({ shift, qty, lamports, poolId }) =>
  ticketSentence({ shift, tickets: plural(qty, 'ticket'), amount: lamports ? sol(lamports) : '', poolId });

/** …and of the (provisional, §2.4) ticket order / refund routes. */
export function buyError(e) {
  if (e?.code === 'agreements_required') return 'Accept the 18+ and loss offer on your profile before a paid shift.';
  if (e?.notConfigured) return 'On-chain ticket sales are not switched on in this build yet – use a promo code meanwhile.';
  if (e?.status === 503) return 'The chain is not reachable from the server right now – nothing was charged. Try again in a minute.';
  if (e?.status === 429) return 'Too many requests – wait a moment and try again.';
  if (e?.code === 'user_rejected' || e?.code === 4001) return 'You declined in the wallet – nothing was charged.';
  if (e?.code === 'not_sellable') return `This pool doesn’t sell tickets right now (closed, full or past its deadline)${e.message ? `: ${e.message}` : ''}.`;
  if (e?.code === 'order_closed') return 'That order is closed – start a new purchase (nothing was charged twice).';
  if (e?.code === 'transaction_mismatch' || e?.code === 'transaction_invalid') return 'The network or the wallet returned a different transaction – nothing was credited for it. Try again.';
  if (e?.code === 'not_refundable') return 'This pool is not refundable – only a pool that failed its goal (or expired unsettled) pays back.';
  if (e?.code === 'nothing_to_refund') return 'Nothing left to refund for this wallet in this pool – it was paid back already.';
  return e?.message ?? String(e);
}

/** Grant audit trail line: what a source means (TicketGrantDto.source). */
export const GRANT_SOURCE = { payment: 'bought on chain', promo: 'promo code', admin: 'gift', spend: 'ride', refund: 'refunded', void: 'voided (pool failed)' };
