import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { escrowExplainer, explorerUrl, explorerTx, statusChip, progressText, deadline, splitParts, rulesText, tierTickets, buyRoom, cardAction, rideError, promoError, promoOk, buyError, usd, pct, sol } from '../../client/site/pools.js';
import { salesOpen } from '../../client/site/tickets-api.js';

/* The pool wording the lobby AND the landing show (client/site/pools.js is pure). Every pool status – incl. `refunding`, which the dev seeds can't produce – is pinned here. */
const DAY = 86_400_000, NOW = Date.UTC(2026, 9, 8, 12);
const pool = (o = {}) => ({ id: 2, address: '7kuWAwuYVynYZQytWJRsYk4K4dGmRzE1LjL5tQFEs8MB', tier: '4h', label: '4H · week 42', status: 'open', priceLamports: 50_000_000, minTickets: 10, maxTickets: 0, maxPerWallet: 5,
  sold: 7, buyers: 6, toGo: 3, progressPct: 70, prepDeadline: NOW + 6 * DAY, playDeadline: NOW + 13 * DAY, vaultLamports: 350_000_000, sponsoredLamports: 0, potLamports: 350_000_000,
  split: { prizeBps: 7000, seedBps: 2000, feeBps: 1000 }, treasuries: { fee: 'Fee1111111111111111111111111111111111111111', seed: 'Seed111111111111111111111111111111111111111' }, roundId: null, ...o });
const ticket = (o = {}) => ({ poolId: 2, tier: '4h', label: '4H · week 42', status: 'open', balance: 1, bought: 0, cap: 5, refundable: false, ...o });
const problem = (status, code, message) => Object.assign(new Error(message), { status, code });

test('explorer links: the pool account / a transaction, on devnet by default, mainnet without the parameter', () => {
  assert.equal(explorerUrl('AbC'), 'https://explorer.solana.com/address/AbC?cluster=devnet');
  assert.equal(explorerUrl('AbC', ''), 'https://explorer.solana.com/address/AbC');
  assert.equal(explorerTx('5ig'), 'https://explorer.solana.com/tx/5ig?cluster=devnet');
});

test('status chip per state: open (needs n / missed its goal), active, refunding, settled', () => {
  assert.deepEqual(statusChip(pool(), NOW), { text: 'NEEDS 3 MORE', cls: 'open' });
  assert.deepEqual(statusChip(pool(), NOW + 7 * DAY), { text: 'MISSED ITS GOAL', cls: 'fail' }, 'an open pool past its deadline never shows a negative countdown');
  assert.deepEqual(statusChip(pool({ status: 'active', toGo: 0 }), NOW), { text: 'LIVE', cls: 'live' });
  assert.deepEqual(statusChip(pool({ status: 'refunding' }), NOW), { text: 'FAILED – REFUND', cls: 'fail' });
  assert.equal(statusChip(pool({ status: 'settled' }), NOW).cls, 'done');
});

test('progress line: "sold / min committed" + what it means', () => {
  assert.equal(progressText(pool(), NOW), '7 / 10 committed · needs 3 more riders to go live');
  assert.equal(progressText(pool({ toGo: 1, sold: 9 }), NOW), '9 / 10 committed · needs 1 more rider to go live');
  assert.equal(progressText(pool({ status: 'active', sold: 12, toGo: 0 }), NOW), '12 / 10 committed · live – rides count');
  assert.match(progressText(pool({ status: 'refunding' }), NOW), /refunded in full/);
});

test('deadline: prep while open, play while active, none once it passed', () => {
  assert.deepEqual(deadline(pool(), NOW), { label: 'goes live if 10 commit by 2026-10-14 · ', at: NOW + 6 * DAY });
  assert.deepEqual(deadline(pool({ status: 'active' }), NOW), { label: 'rides count until 2026-10-21 · closes in ', at: NOW + 13 * DAY });
  assert.equal(deadline(pool(), NOW + 7 * DAY).at, null);
  assert.equal(deadline(pool({ status: 'refunding' }), NOW).at, null);
});

test('split + rules copy come from the pool (never hard-coded)', () => {
  const odd = pool({ split: { prizeBps: 6550, seedBps: 2450, feeBps: 1000 }, minTickets: 4 });
  assert.deepEqual(splitParts(odd).map(s => s.bps), [6550, 2450, 1000]);
  assert.equal(rulesText(odd), 'Your entry sits in the pool’s vault on chain – not with us. If fewer than 4 riders commit by 2026-10-14, every ticket is refunded in full. Live pool: 65.5% prizes, 24.5% seeds the next pool, 10% fees.');
  assert.equal(pct(7000), '70%'); assert.equal(sol(50_000_000), '0.050 SOL'); assert.equal(usd(50_000_000, 118), '≈ $5.90'); assert.equal(usd(1, null), '');
});

test('tickets per tier: only ACTIVE balances are ridable, across every pool of the tier', () => {
  const t = tierTickets([ticket({ poolId: 1, tier: '1h', status: 'active', balance: 2 }), ticket({ poolId: 3, tier: '1h', status: 'active', balance: 1 }), ticket(), ticket({ poolId: 4, tier: '1h', status: 'refunding', balance: 0, bought: 2, refundable: true })], '1h');
  assert.equal(t.ridable, 3); assert.equal(t.waiting, 0); assert.equal(t.refundable.length, 1); assert.equal(t.rows.length, 3);
  assert.equal(tierTickets(undefined, '1h').ridable, 0);
});

test('the card action: RIDE > CLAIM REFUND > WAITING > BUY', () => {
  const tt = rows => tierTickets(rows, '4h');
  assert.deepEqual(cardAction(pool({ status: 'active' }), tt([ticket({ status: 'active', balance: 2 })]), NOW), { kind: 'ride', text: 'RIDE (2 left)' });
  assert.deepEqual(cardAction(pool({ status: 'refunding' }), tt([ticket({ status: 'refunding', balance: 0, bought: 1, refundable: true })]), NOW), { kind: 'refund', text: 'CLAIM REFUND' });
  assert.deepEqual(cardAction(pool(), tt([ticket()]), NOW), { kind: 'wait', text: 'WAITING FOR 3 MORE RIDERS' });
  assert.deepEqual(cardAction(pool({ toGo: 1 }), tt([ticket()]), NOW), { kind: 'wait', text: 'WAITING FOR 1 MORE RIDER' });
  assert.equal(cardAction(pool(), tt([ticket()]), NOW + 7 * DAY).kind, 'none');
  assert.equal(cardAction(pool(), tt([]), NOW).kind, 'buy');
});

test('buy room: the per-wallet cap counts what was ever BOUGHT (like the program), promo tickets do not', () => {
  assert.equal(buyRoom(pool(), undefined), 5); assert.equal(buyRoom(pool(), ticket({ bought: 3, balance: 9 })), 2); assert.equal(buyRoom(pool(), ticket({ bought: 7 })), 0);
});

test('every 409 of POST /api/rides reads as a sentence', () => {
  assert.equal(rideError(problem(409, 'no_tickets', 'no 1h tickets left'), '1h'), 'No 1 HOUR tickets left – buy one or redeem a promo code.');
  assert.match(rideError(problem(409, 'pool_not_live', 'pool not live yet – 3 more tickets needed'), '4h'), /^The pool is still waiting for riders \(pool not live yet – 3 more tickets needed\)\. .*refunded in full/);
  assert.match(rideError(problem(409, 'conflict', 'a ride is already in progress'), '1h'), /already have a ride on the road/);
  assert.equal(rideError(problem(503, 'service_unavailable', 'no SOL/USD price available right now'), '8h'), 'no SOL/USD price available right now');
});

test('promo redeem: 404 / every 409 code / success', () => {
  assert.equal(promoError(problem(404, 'not_found', 'no such promo code')), 'Unknown promo code – check the spelling.');
  assert.equal(promoError(problem(409, 'promo_unavailable', 'you have already redeemed this promo code')), 'This code can’t be used: you have already redeemed this promo code.');
  assert.match(promoError(problem(409, 'no_open_pool', 'no 1h pool is open right now')), /^No pool to put these tickets in: no 1h pool is open right now\.$/);
  assert.match(promoError(problem(409, 'ticket_cap', 'you already hold the maximum of 5 tickets in this pool')), /^Wallet cap reached/);
  assert.equal(promoOk({ code: 'WELCOME', poolId: 1, tier: '1h', added: 2, balance: 2, cap: 5 }), '+2 tickets (WELCOME) in pool #1 · you hold 2 · cap 5');
  assert.match(promoOk({ code: 'X', poolId: 1, tier: '1h', added: 0, balance: 5, cap: 5 }), /at the cap, nothing added/);
});

test('promo redeem: every kind of effect reads as one sentence; an item you own is refused without using the code up', () => {
  assert.equal(promoOk({ kind: 'tickets', code: 'WELCOME', label: '2 × 1h ride tickets', poolId: 1, tier: '1h', added: 2, balance: 2, cap: 5 }), '+2 tickets (WELCOME) in pool #1 · you hold 2 · cap 5');
  assert.equal(promoOk({ kind: 'free_rides', code: 'THREE', label: '3 free rides', added: 3, freeRides: 8 }), '+3 free rides (THREE) · you now have 8');
  assert.equal(promoOk({ kind: 'free_rides', code: 'ONE', label: '1 free ride', added: 1, freeRides: 6 }), '+1 free ride (ONE) · you now have 6');
  assert.match(promoOk({ kind: 'cosmetic', code: 'GOLD', label: 'wheel: gold', slot: 'wheel', item: 'gold' }), /^Unlocked wheel: gold \(GOLD\) – it is on your truck now/);
  assert.match(promoError(problem(409, 'already_owned', 'you already own this item')), /already own this item – the code was not used up/);
  assert.match(promoError(problem(409, 'promo_unavailable', 'this promo code is not active yet')), /not active yet/);
});

test('ticket sales: on when the server sells through the program (tiers.paymentMode), a ticketSales flag would win; every refusal names the fix', () => {
  assert.equal(salesOpen({ paymentMode: 'transfer' }), false); assert.equal(salesOpen({ paymentMode: 'program' }), true); assert.equal(salesOpen(null), false);
  assert.equal(salesOpen({ paymentMode: 'program', ticketSales: false }), false); assert.equal(salesOpen({ paymentMode: 'transfer', ticketSales: true }), true);
  assert.match(buyError({ notConfigured: true }), /not switched on/);
  assert.match(buyError(problem(429, 'rate_limited', 'slow down')), /Too many requests/);
  assert.match(buyError(Object.assign(new Error('User rejected the request.'), { code: 4001 })), /declined/);
  assert.match(buyError(problem(409, 'not_sellable', 'the pool is past its deadline')), /^This pool doesn’t sell tickets right now .*: the pool is past its deadline\.$/);
  assert.match(buyError(problem(409, 'order_closed', 'x')), /start a new purchase/);
  assert.match(buyError(problem(400, 'transaction_mismatch', 'x')), /different transaction/);
  assert.match(buyError(problem(409, 'not_refundable', 'x')), /not refundable/);
  assert.match(buyError(problem(409, 'nothing_to_refund', 'x')), /paid back already/);
});

test('the lobby and the landing never call a bare /api path or render with innerHTML', () => {
  const site = join(new URL('..', import.meta.url).pathname, '..', 'client', 'site');
  for (const f of ['lobby.js', 'lobby-pools.js', 'lobby-promo.js', 'lobby-garage.js', 'garage-cab.js', 'pools.js', 'tickets-api.js', 'pay.js', 'dom.js', 'admin.js', 'admin-promos.js']) {
    const src = readFileSync(join(site, f), 'utf8');
    assert.doesNotMatch(src, /\.(innerHTML|outerHTML)\s*[+]?=|insertAdjacentHTML\(|document\.write\(/, f);
    assert.doesNotMatch(src, /['"`]\/api\//, `${f}: API calls go through wallet.js (API_BASE)`);
    assert.doesNotMatch(src, /['`]\/play\.html/, `${f}: the game is GAME_BASE`);
  }
});

test('the escrow explainer is the whitepaper chapter, and the standalone copy is gone', () => {
  const root = join(new URL('..', import.meta.url).pathname, '..');
  assert.equal(escrowExplainer(), '/whitepaper.html#onchain');
  assert.equal(existsSync(join(root, 'client/escrow')), false);
  assert.equal(existsSync(join(root, 'docs/pool-escrow')), false);
  for (const f of ['client/site/lobby.js', 'client/site/lobby-pools.js', 'landing/src/main.js', 'landing/vite.config.js']) {
    assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /\/escrow\//, f);
  }
});
