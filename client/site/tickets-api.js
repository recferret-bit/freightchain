import { api } from './wallet.js';

/* THE seam for the ticket routes of W3 (orders, refunds, payouts) and W4 (chain): one function per route, shapes as BUILT on `paid-tickets` @ b860f9d
   (TicketOrderDto, TicketPaymentDto, RefundTransactionDto, SettledSignatureDto, ChainFeesDto). If a shape changes, fix it HERE only.
   The lobby never calls them on page load unless sales are on: `salesOpen()` = the server sells through the program (`GET /api/tiers` → paymentMode 'program';
   a `ticketSales` boolean there would win). A call that reaches a server without the route (404 "Cannot GET …") or without a program (503 on POST /api/tickets)
   rejects with `{ notConfigured: true }`. */

export const salesOpen = tiers => (typeof tiers?.ticketSales === 'boolean' ? tiers.ticketSales : tiers?.paymentMode === 'program');

const missing = e => e?.status === 404 && /^Cannot (GET|POST|PUT|DELETE)/.test(e.message ?? '');
const notConfigured = e => Object.assign(new Error('on-chain ticket sales are not switched on in this build'), { notConfigured: true, status: e?.status, cause: e });
async function call(path, body, { unavailable503 = false } = {}) {
  try { return await api(path, body); } catch (e) { throw missing(e) || (unavailable503 && e.status === 503) ? notConfigured(e) : e; }
}
const id = x => encodeURIComponent(x);

/** GET /api/chain/fees[?poolId] (public) → `{ priorityMicrolamports, computeUnits, estimatedFeeLamports, blockhashTtlSeconds }` (the wallet pays it). */
export const chainFees = poolId => call(`chain/fees${poolId != null ? `?poolId=${id(poolId)}` : ''}`);

/** POST /api/tickets {poolId, qty} → TicketOrderDto `{ id, poolId, qty, lamports, status: awaiting_payment|paid|expired|refunded, createdAt, expiresAt, paidAt, refundedAt, signature }`
 *  · 503 no program (→ notConfigured) · 404 pool · 409 `not_sellable`. */
export const createOrder = (poolId, qty) => call('tickets', { poolId, qty }, { unavailable503: true });

/** GET /api/tickets/orders/:id → TicketOrderDto. */
export const getOrder = orderId => call(`tickets/orders/${id(orderId)}`);

/** GET /api/tickets/pending → `{ order: TicketOrderDto | null }`. */
export const pendingOrder = () => call('tickets/pending');

/** GET /api/tickets/orders/:id/payment → `{ orderId, mode, programId, poolId, lamports, transaction (base64, unsigned; the wallet is the fee payer), message, feePayer, computeUnits,
 *  priorityMicrolamports, blockhash, lastValidBlockHeight }` · 409 `order_closed`. Every call builds a fresh transaction (new blockhash). */
export const orderPayment = orderId => call(`tickets/orders/${id(orderId)}/payment`);

/** POST /api/tickets/orders/:id/confirm {signature} → `{ status: paid|pending, order }` · 400 `transaction_invalid` / `transaction_mismatch`. */
export const confirmOrder = (orderId, signature) => call(`tickets/orders/${id(orderId)}/confirm`, { signature });

/** GET /api/pools/:id/refund → `{ poolId, needsFail, lamports, transaction, message, feePayer, lastValidBlockHeight }` (the wallet signs AND sends)
 *  · 409 `not_refundable` / `nothing_to_refund`. */
export const refundTransaction = poolId => call(`pools/${id(poolId)}/refund`);

/** POST /api/chain/settle {signature} → `{ signature, status: pending|invalid|done, detail, events: [{ index, kind, poolId, outcome, orderId, detail }] }` – tells the server about a
 *  transaction the wallet sent (a refund); the program-log watcher would find it anyway, this is the fast path. */
export const settleSignature = signature => call('chain/settle', { signature });

/** GET /api/pools/:id/payout (the admin wallet only, 403 otherwise) → `{ poolId, prizeLamports, ranks: [{ rank, wallet, distance, rides, lamports, paid }],
 *  transactions: [{ rank, to, lamports, transaction, message, lastValidBlockHeight }], close: { transaction, message, lastValidBlockHeight } | null }`. Not used by the lobby yet. */
export const payoutTransactions = poolId => call(`pools/${id(poolId)}/payout`);
