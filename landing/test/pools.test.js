import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { escrowExplainer, explorerUrl, explorerTx, poolPhase, phaseLine, payoutText, poolSchedule, scheduleText, hasStandings, span, statusChip, progressText, deadline, splitParts, rulesText, tierTickets, buyRoom, cardAction, rideError, promoError, promoOk, buyError, ticketShareText, xIntent, usd, pct, sol, heldTickets, paidChip, ridableTickets } from '../../client/site/pools.js';
import { homeBlinkUrl, pledgeShareText, ridePageUrl, rideShareText } from '../../client/js/ui/share.js';
import { salesOpen } from '../../client/site/tickets-api.js';

/* The pool wording the lobby AND the landing show (client/site/pools.js is pure). Every pool status – incl. `refunding`, which the dev seeds can't produce – is pinned here. */
const DAY = 86_400_000, NOW = Date.UTC(2026, 9, 8, 12);
const pool = (o = {}) => ({ id: 2, address: '7kuWAwuYVynYZQytWJRsYk4K4dGmRzE1LjL5tQFEs8MB', tier: '4h', label: '4H · week 42', status: 'open', priceLamports: 50_000_000, minTickets: 10, maxTickets: 0, maxPerWallet: 5,
  sold: 7, buyers: 6, toGo: 3, progressPct: 70, prepDeadline: NOW + 6 * DAY, playDeadline: NOW + 13 * DAY, payoutAt: NOW + 15 * DAY, payout: { state: 'pending', note: null, held: false }, vaultLamports: 350_000_000, sponsoredLamports: 0, potLamports: 350_000_000,
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
  assert.deepEqual(deadline(pool({ status: 'active' }), NOW), { label: 'new rides until 2026-10-14 · closes in ', at: NOW + 6 * DAY }, 'no new ride after the sale end');
  assert.deepEqual(deadline(pool({ status: 'active' }), NOW + 8 * DAY), { label: 'no new rides – shifts finish by 2026-10-21 · ', at: NOW + 13 * DAY });
  assert.equal(deadline(pool(), NOW + 7 * DAY).at, null);
  assert.equal(deadline(pool({ status: 'refunding' }), NOW).at, null);
});

/* the daily series: a 1h pool sells 24 h (new rides start only then), 3 h to finish, 48 h review, then the payout job pays */
const H = 3_600_000, series = (o = {}) => pool({ tier: '1h', status: 'active', toGo: 0, prepDeadline: NOW + 14 * H, playDeadline: NOW + 17 * H, payoutAt: NOW + 65 * H, ...o });

test('phase mirrors Pool.phase: selling (open OR active inside the sale) → riding → review → payout; failed; closed', () => {
  assert.equal(poolPhase(series(), NOW), 'selling', 'an ACTIVE pool still inside its sale window is selling');
  assert.equal(poolPhase(pool(), NOW), 'selling');
  assert.equal(poolPhase(pool(), NOW + 7 * DAY), 'failed', 'an OPEN pool past its sale end missed its goal');
  assert.equal(poolPhase(series(), NOW + 15 * H), 'riding');
  assert.equal(poolPhase(series(), NOW + 17 * H), 'review');
  assert.equal(poolPhase(series(), NOW + 65 * H), 'payout');
  assert.equal(poolPhase(series({ status: 'refunding' }), NOW), 'failed', 'refunding wins over the clock');
  assert.equal(poolPhase(series({ status: 'settled' }), NOW), 'closed');
  assert.equal(poolPhase(series({ status: 'cancelled' }), NOW + 15 * H), 'closed');
});

test('phase line: ON SALE / FINISHING / IN REVIEW with a coarse countdown, then what the payout job did', () => {
  assert.deepEqual([span(14 * H), span(80 * 60_000), span(31 * H), span(3 * DAY + H), span(7 * 60_000), span(2 * H), span(0)], ['14 h', '1 h 20 m', '31 h', '3 d', '7 m', '2 h', '1 m']);
  assert.equal(phaseLine(series(), NOW).text, 'ON SALE · 14 h left');
  assert.deepEqual((({ head, at, pre, post, cls }) => ({ head, at, pre, post, cls }))(phaseLine(series(), NOW)), { head: 'ON SALE', at: NOW + 14 * H, pre: '', post: ' left', cls: 'open' });
  assert.equal(phaseLine(series(), NOW + 15 * H + 40 * 60_000).text, 'FINISHING · no new rides · 1 h 20 m left');
  assert.equal(phaseLine(series(), NOW + 33 * H).text, 'IN REVIEW · winners paid in 32 h');
  const paying = st => phaseLine(series({ payout: { state: st, note: null, held: false } }), NOW + 70 * H).text;
  assert.deepEqual(['pending', 'paying', 'paid', 'waiting_review', 'no_winners', 'error'].map(paying), ['PAYING WINNERS', 'PAYING WINNERS', 'PAID', 'PAYOUT WAITS FOR REVIEW', 'NO WINNERS', 'PAYOUT DELAYED']);
  assert.equal(phaseLine(series({ payout: { state: 'pending', note: 'x', held: true } }), NOW + 70 * H).text, 'PAYOUT ON HOLD', 'a hold wins over the job state');
  assert.equal(phaseLine(series({ status: 'refunding' }), NOW).text, 'REFUNDING');
  assert.equal(phaseLine(pool(), NOW + 7 * DAY).text, 'MISSED ITS GOAL');
  assert.equal(phaseLine(series({ status: 'settled', payout: { state: 'paid', note: null, held: false } }), NOW).text, 'PAID');
  assert.equal(phaseLine(series({ status: 'settled', payout: { state: 'no_winners', note: null, held: false } }), NOW).text, 'NO WINNERS');
  assert.equal(phaseLine(series({ status: 'cancelled' }), NOW).cls, 'done');
});

test('chip + progress line know when the rides are over', () => {
  assert.deepEqual(statusChip(series(), NOW + 15 * H), { text: 'LIVE', cls: 'live' });
  assert.deepEqual(statusChip(series(), NOW + 20 * H), { text: 'IN REVIEW', cls: 'open' });
  assert.deepEqual(statusChip(series(), NOW + 70 * H), { text: 'PAYOUT', cls: 'live' });
  assert.match(progressText(series(), NOW + 20 * H), /rides are over$/);
});

test('payout line: hold, rides under review, no winners, delayed; nothing while pending', () => {
  assert.equal(payoutText({ state: 'waiting_review', note: null, held: true }, 3), 'ON HOLD – an admin is checking');
  assert.equal(payoutText({ state: 'pending', note: 'odd lap times', held: true }, 0), 'ON HOLD – an admin is checking (odd lap times)');
  assert.equal(payoutText({ state: 'waiting_review', note: null, held: false }, 3), '3 rides still under review – the payout waits for every one');
  assert.equal(payoutText({ state: 'waiting_review', note: null, held: false }, 1), '1 ride still under review – the payout waits for every one');
  assert.match(payoutText({ state: 'no_winners', note: null, held: false }, 0), /^no verified finisher/);
  assert.match(payoutText({ state: 'error', note: 'rpc down', held: false }, 0), /^payout delayed/);
  assert.equal(payoutText({ state: 'pending', note: null, held: false }, 0), '');
  assert.equal(payoutText(undefined, 0), '');
});

test('series rule: from the tier schedule, else from the pool timestamps (no sale length there)', () => {
  assert.equal(scheduleText({ saleHours: 24, playHours: 3, reviewHours: 48 }), 'a new pool every 24 h · sales and new rides close after 24 h · 3 h to finish · 48 h review before prizes');
  assert.deepEqual(poolSchedule(series()), { saleHours: null, playHours: 3, reviewHours: 48 });
  assert.equal(scheduleText(poolSchedule(series())), '3 h to finish · 48 h review before prizes');
  assert.equal(scheduleText(poolSchedule(pool({ payoutAt: NOW + 13 * DAY }))), '168 h to finish', 'no review window = no review words');
});

test('a winners list exists once rides count, never while selling or for a failed / cancelled pool', () => {
  assert.deepEqual([NOW, NOW + 15 * H, NOW + 20 * H, NOW + 70 * H].map(t => hasStandings(series(), t)), [false, true, true, true]);
  assert.equal(hasStandings(series({ status: 'settled' }), NOW), true);
  assert.equal(hasStandings(series({ status: 'cancelled' }), NOW), false);
  assert.equal(hasStandings(series({ status: 'refunding' }), NOW + 20 * H), false);
  assert.equal(hasStandings(pool(), NOW + 7 * DAY), false);
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

test('tickets past their pool\'s play deadline are not ridable (the server flag or rideBy on this clock) and are listed as closed', () => {
  const live = ticket({ poolId: 1, tier: '1h', status: 'active', balance: 1, ridable: true, rideBy: NOW + 60_000 });
  const over = ticket({ poolId: 0, tier: '1h', status: 'active', balance: 1, ridable: true, rideBy: NOW - 1 });
  const flagged = ticket({ poolId: 2, tier: '1h', status: 'active', balance: 1, ridable: false, rideBy: NOW + 60_000 });
  const t = tierTickets([live, over, flagged], '1h', NOW);
  assert.equal(t.ridable, 1);
  assert.equal(t.rideBy, NOW + 60_000);
  assert.deepEqual(t.closed.map(c => c.poolId), [0, 2]);
  assert.equal(ridableTickets([live, over, flagged], NOW), 1);
  assert.equal(tierTickets([over], '1h', NOW).rideBy, null);
  assert.equal(cardAction(pool({ status: 'open' }), tierTickets([over], '1h', NOW), NOW).kind, 'buy');
});

test('the header counts tickets you hold, including a pool that is still filling', () => {
  const rows = [ticket({ poolId: 1, tier: '1h', status: 'active', balance: 2 }), ticket({ status: 'open', balance: 1 }), ticket({ poolId: 4, status: 'refunding', balance: 0, bought: 2, refundable: true })];
  assert.equal(ridableTickets(rows), 2);
  assert.equal(heldTickets(rows), 3);
  assert.equal(paidChip(rows), '3 paid ride tickets · 1 waiting');
  assert.equal(paidChip([ticket({ status: 'open', balance: 1 })]), '1 paid ride ticket · waiting');
  assert.equal(paidChip([ticket({ status: 'active', balance: 1 })]), '1 paid ride ticket');
  assert.equal(paidChip(undefined), '0 paid ride tickets');
  assert.equal(paidChip([ticket({ status: 'active', balance: 1, rideBy: NOW - 1 })], NOW), '0 paid ride tickets'); // rides closed: expired, not held
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
  assert.equal(rideError(problem(409, 'rides_closed', 'rides for pool #0 closed at 2026-10-11T17:00:00.000Z'), '1h'), 'Rides for your 1 HOUR ticket are over (rides for pool #0 closed at 2026-10-11 17:00 UTC). A ticket counts only in its own pool – buy one in the pool on sale now.');
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
  assert.equal(promoOk({ kind: 'ride', code: 'HAUL', label: 'one free 4h ride (not for sale)', tier: '4h' }), 'One free 4h ride (HAUL). It is not for sale. Start it from your profile. It does not mint TEN4.');
  assert.equal(promoOk({ kind: 'free_rides', code: 'THREE', label: '3 free rides', added: 3, freeRides: 8 }), '+3 free rides (THREE) · you now have 8');
  assert.equal(promoOk({ kind: 'free_rides', code: 'ONE', label: '1 free ride', added: 1, freeRides: 6 }), '+1 free ride (ONE) · you now have 6');
  assert.match(promoOk({ kind: 'cosmetic', code: 'GOLD', label: 'wheel: gold', slot: 'wheel', item: 'gold' }), /^Unlocked wheel: gold \(GOLD\) – it is on your truck now/);
  assert.match(promoError(problem(409, 'already_owned', 'you already own this item')), /already own this item – the code was not used up/);
  assert.match(promoError(problem(409, 'promo_unavailable', 'this promo code is not active yet')), /not active yet/);
});

test('the 𝕏 post after a ticket buy: tier, count, amount, pool, the escrow on Solana devnet – short enough for the blink link', () => {
  const text = ticketShareText({ shift: '4 HOURS', qty: 2, lamports: 100_000_000, poolId: 7 });
  assert.equal(text, 'Ride paid 🚛 2 tickets for a 4 HOURS shift in @FreightChainSol – 0.100 SOL in pool #7’s escrow on @solana devnet. The link buys one ticket into a pool on sale (18+ and loss terms on the site).');
  assert.ok(text.length + 1 + 23 <= 280);   // t.co counts every url as 23
  assert.match(ticketShareText({ shift: '1 HOUR', qty: 1, lamports: 0, poolId: 3 }), /^Ride paid 🚛 1 ticket for a 1 HOUR shift in @FreightChainSol in pool #3’s/);
  const tx = explorerTx('5abc');
  assert.equal(xIntent('a b & c', tx), `https://x.com/intent/post?text=a%20b%20%26%20c&url=${encodeURIComponent(tx)}`);
});

test('blink urls: the site home, and a ride page whose id is encoded', () => {
  assert.equal(homeBlinkUrl('', 'http://localhost:3000'), 'http://localhost:3000/');
  assert.equal(homeBlinkUrl('https://freightchain.fun/', 'http://localhost:3000'), 'https://freightchain.fun/');
  assert.equal(ridePageUrl('', 'http://localhost:3000', 'ride_1'), 'http://localhost:3000/r/ride_1');
  assert.equal(ridePageUrl('https://freightchain.fun', '', 'ab/c d'), 'https://freightchain.fun/r/ab%2Fc%20d');
});

test('the 𝕏 post after a pledge: who, the rate, the cap – short enough for the ride link, and not a bet', () => {
  const text = pledgeShareText({ driver: 'AbCd…wxyz', rate: '0.001 SOL', km: 10 });
  assert.equal(text, 'Locked 0.001 SOL/km for AbCd…wxyz, up to 10 km, in @FreightChainSol. They are paid for the kilometres they finish. The rest comes back. Watch the ride. @solana devnet.');
  assert.ok(text.length + 1 + 23 <= 280);
  assert.equal(pledgeShareText({ driver: '', rate: '0.000001 SOL', km: 1 }), 'Locked 0.000001 SOL/km for the driver, up to 1 km, in @FreightChainSol. They are paid for the kilometres they finish. The rest comes back. Watch the ride. @solana devnet.');
  assert.doesNotMatch(text, /verified|prize|bet|jackpot|lottery/i);
});

test('ride share text: free driving, paid driving, a finished shift that never says verified', () => {
  assert.equal(rideShareText({ phase: 'driving', route: 'I-80', km: '12.3 km', time: '04:05', free: true }), 'Driving I-80 in @FreightChainSol. 12.3 km in (04:05). Watch along from the link. @solana devnet.');
  assert.equal(rideShareText({ phase: 'driving', route: '', km: '1.0 km', time: '00:10', free: false }), 'Driving the road in @FreightChainSol. 1.0 km in (00:10). Watch the shift, or buy a ticket, from the link. @solana devnet.');
  const done = rideShareText({ phase: 'finished', route: 'I-80', tier: '4h', km: '412.00', outcome: 'COMPLETE' });
  assert.equal(done, 'Finished a 4h shift on I-80 in @FreightChainSol. 412.00 km · COMPLETE. Watch the replay or buy a ticket from the link. @solana devnet.');
  assert.doesNotMatch(done, /verified/i);
  assert.doesNotMatch(rideShareText({ phase: 'finished', tier: '1h', km: '3.00', outcome: 'FAILED' }), /verified/i);
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
  for (const f of ['lobby.js', 'lobby-new.js', 'lobby-live.js', 'lobby-profile.js', 'lobby-replays.js', 'lobby-board.js', 'lobby-achievements.js', 'lobby-pools.js', 'admin-pools.js', 'lobby-promo.js', 'lobby-garage.js', 'garage-cab.js', 'pools.js', 'tickets-api.js', 'pay.js', 'dom.js', 'ui.js', 'effects.js', 'admin.js', 'admin-promos.js', 'ticket-dialog.js']) {
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
  for (const f of ['client/site/lobby.js', 'client/site/lobby-new.js', 'client/site/lobby-pools.js', 'landing/src/main.js', 'landing/src/boards.js', 'landing/vite.config.js']) {
    assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /\/escrow\//, f);
  }
});
