/* Escrowed prize pools as the lobby and the landing show them (docs/paid-tickets-plan.md §0, §2.8). PURE: no DOM, no fetch – unit-tested by landing/test/pools.test.js.
   Inputs are the server's DTOs: PrizePoolDto (/api/pools, /api/tiers[].pool), TicketBalanceDto (/api/me.tickets), RFC 9457 problems (Error with .status/.code). Lamports and epoch ms. */

/** The cluster the pools live on (explorer links). '' = mainnet-beta (no query parameter). */
export const CLUSTER = 'devnet';
export const explorerUrl = (address, cluster = CLUSTER) => `https://explorer.solana.com/address/${encodeURIComponent(address)}${cluster ? `?cluster=${cluster}` : ''}`;
export const explorerTx = (signature, cluster = CLUSTER) => `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${cluster ? `?cluster=${cluster}` : ''}`;
export const ESCROW_PAGE = '/escrow/';   // client/escrow/index.html (a copy of docs/pool-escrow, served on the apex) – prefix with SITE_BASE

export const shortAddr = a => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a ?? '');   // THE wallet / account shortener: the lobby, admin, the game's live streams and the landing (format.js `short`) all use it
export const sol = l => `${(l / 1e9).toFixed(l >= 1e9 ? 2 : 3)} SOL`;
export const usd = (l, solUsd) => (solUsd ? `≈ $${((l / 1e9) * solUsd).toFixed(2)}` : '');
export const pct = bps => `${+(bps / 100).toFixed(2)}%`;
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const pad = n => String(Math.floor(n)).padStart(2, '0');
export const left = ms => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400); return `${d ? d + 'd ' : ''}${pad((s % 86400) / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`; };
export const day = ms => new Date(ms).toISOString().slice(0, 10);   // UTC date, the same for every viewer

export const STATUS_CLS = { active: 'live', open: 'open', refunding: 'fail', settled: 'done', cancelled: 'done' };
/** Status chip: { text, cls } – cls is one of live / open / fail / done. `now` = server-corrected epoch ms. */
export function statusChip(p, now) {
  if (p.status === 'active') return { text: 'LIVE', cls: 'live' };
  if (p.status === 'open') return now >= p.prepDeadline ? { text: 'MISSED ITS GOAL', cls: 'fail' } : { text: `NEEDS ${p.toGo} MORE`, cls: 'open' };
  if (p.status === 'refunding') return { text: 'FAILED – REFUND', cls: 'fail' };
  if (p.status === 'settled') return { text: 'SETTLED', cls: 'done' };
  return { text: p.status.toUpperCase(), cls: 'done' };
}

/** The progress line under the bar: "7 / 10 committed" + what it means. */
export function progressText(p, now) {
  const head = `${p.sold} / ${p.minTickets} committed`;
  if (p.status === 'active') return `${head} · live – rides count`;
  if (p.status === 'open') return now >= p.prepDeadline ? `${head} · missed its goal – refunds follow` : `${head} · needs ${plural(p.toGo, 'more rider')} to go live`;
  if (p.status === 'refunding') return `${head} · failed – every ticket is refunded in full`;
  return head;
}

/** The deadline that matters now: { label, at } (at = epoch ms, null = none). */
export function deadline(p, now) {
  if (p.status === 'open') return now >= p.prepDeadline ? { label: 'goal deadline passed', at: null } : { label: `goes live if ${p.minTickets} commit by ${day(p.prepDeadline)} · `, at: p.prepDeadline };
  if (p.status === 'active') return now >= p.playDeadline ? { label: 'play window closed – settling', at: null } : { label: `rides count until ${day(p.playDeadline)} · closes in `, at: p.playDeadline };
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

/** What a wallet holds for one tier, across every pool of it (pools overlap at a week boundary). `ridable` = unused tickets in ACTIVE pools – what POST /api/rides can spend. */
export function tierTickets(tickets, tier) {
  const rows = (tickets ?? []).filter(t => t.tier === tier);
  return { rows, ridable: rows.filter(t => t.status === 'active').reduce((a, t) => a + t.balance, 0), waiting: rows.filter(t => t.status === 'open').reduce((a, t) => a + t.balance, 0), refundable: rows.filter(t => t.refundable) };
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
  if (e?.code === 'no_tickets') return `No ${tierName(tier)} tickets left – buy one or redeem a promo code.`;
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
/** What a redemption did, as one sentence – the answer is `{ kind: 'tickets' | 'free_rides' | 'cosmetic', code, label, … }`. */
export function promoOk(r) {
  if (r.kind === 'free_rides') return `+${plural(r.added, 'free ride')} (${r.code}) · you now have ${r.freeRides}`;
  if (r.kind === 'cosmetic') return `Unlocked ${r.label} (${r.code}) – it is on your truck now. Pick parts in the GARAGE.`;
  return `+${plural(r.added, 'ticket')} (${r.code}) in pool #${r.poolId} · you hold ${r.balance} · cap ${r.cap}${r.added === 0 ? ' – you are at the cap, nothing added' : ''}`;
}

/** …and of the (provisional, §2.4) ticket order / refund routes. */
export function buyError(e) {
  if (e?.notConfigured) return 'On-chain ticket sales are not switched on in this build yet – use a promo code meanwhile.';
  if (e?.status === 503) return 'The chain is not reachable from the server right now – nothing was charged. Try again in a minute.';
  if (e?.status === 429) return 'Too many sponsored transactions today – pay the network fee yourself (≈ 0.0001 SOL).';
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
