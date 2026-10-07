import { api } from './wallet.js';

/* THE seam for the ticket routes that are NOT built yet (docs/paid-tickets-plan.md §2.4, W3 orders / W4 chain): every function mirrors one route, so the real server drops in
   without touching the lobby. Shapes are PROVISIONAL (the §2.4 table) – when W3/W4 land, check them against the built DTOs and fix them HERE only.
   Until then the lobby never calls them on page load: `salesOpen()` is false, BUY is shown disabled, and a call that reaches a server without the route
   (404 "Cannot GET …") or with the chain switched off (503 on POST /api/tickets) rejects with `{ notConfigured: true }`. */

/** Flip when the order routes are deployed – or, better, let the server say so: `GET /api/tiers` → `ticketSales: true` wins over this constant. */
export const ORDERS_BUILT = false;
export const salesOpen = tiers => (typeof tiers?.ticketSales === 'boolean' ? tiers.ticketSales : ORDERS_BUILT);

const missing = e => e?.status === 404 && /^Cannot (GET|POST|PUT|DELETE)/.test(e.message ?? '');
const notConfigured = e => Object.assign(new Error('on-chain ticket sales are not switched on in this build'), { notConfigured: true, status: e?.status, cause: e });
async function call(path, body, { unavailable503 = false } = {}) {
  try { return await api(path, body); } catch (e) { throw missing(e) || (unavailable503 && e.status === 503) ? notConfigured(e) : e; }
}

/** GET /api/chain/fees (public, W4) → `{ priorityMicrolamports, computeUnits, estimatedFeeLamports, sponsored, blockhashTtlSeconds }`. */
export const chainFees = () => call('chain/fees');

/** POST /api/tickets {poolId, qty} (W3) → TicketOrderDto `{ id, poolId, qty, lamports, status, paidAt, refundedAt }` · 409 pool not open / over cap / another order live · 503 chain not configured. */
export const createOrder = (poolId, qty) => call('tickets', { poolId, qty }, { unavailable503: true });

/** GET /api/tickets/orders/:id (W3) → TicketOrderDto (poll until `paid`). */
export const getOrder = id => call(`tickets/orders/${encodeURIComponent(id)}`);

/** GET /api/tickets/orders/:id/payment (W3 → W4) → `{ mode, programId, pool, lamports, blockhash, lastValidBlockHeight, transaction }` (transaction = base64, unsigned). */
export const orderPayment = id => call(`tickets/orders/${encodeURIComponent(id)}/payment`);

/** POST /api/tickets/orders/:id/confirm {signature} (W3 fast path) → `{ status: 'paid', order, tickets } | { status: 'pending' } | { status: 'expired' }`. */
export const confirmOrder = (id, signature) => call(`tickets/orders/${encodeURIComponent(id)}/confirm`, { signature });

/** POST /api/tickets/orders/:id/submit {signedTransaction} (W3 → W4, the gasless path §2.10) → `{ signature }` · 400 message differs / stale · 429 sponsorship cap · 503 sponsor empty. */
export const submitOrder = (id, signedTransaction) => call(`tickets/orders/${encodeURIComponent(id)}/submit`, { signedTransaction });

/** GET /api/tickets/pending (W3) → `{ order: TicketOrderDto | null }`. */
export const pendingOrder = () => call('tickets/pending');

/** GET /api/pools/:id/refund (W3 → W4) → `{ transaction, sponsored }` – unsigned `fail_pool` (if needed) + `refund(me)` · 409 not refundable. */
export const refundTransaction = poolId => call(`pools/${encodeURIComponent(poolId)}/refund`);

/** NOT IN §2.4 – asked for: where a SPONSORED refund goes after the wallet signed it (the order `/submit` only takes orders). Provisional: POST /api/pools/:id/refund/submit {signedTransaction} → `{ signature }`. */
export const submitRefund = (poolId, signedTransaction) => call(`pools/${encodeURIComponent(poolId)}/refund/submit`, { signedTransaction });
