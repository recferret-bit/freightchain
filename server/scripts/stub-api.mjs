// A STUB of the API for front-end work on the ticket flows without a chain (docs/agents/escrow.md): pools in EVERY status (open, active,
// refunding – which the dev seeds can't make), and the order / payment / confirm / refund / settle routes of W3/W4 with real (unsigned, never sent) web3.js
// transactions, so client/site/pay.js runs end to end against a fake wallet. Serves landing/dist at / (if built) and client/ like Nest. One signed-in wallet, no auth, all in memory.
// Nothing touches a network or a chain: the "chain" here is a counter. Usage (from server/): PORT=3150 node scripts/stub-api.mjs   then open http://localhost:3150/lobby.html
// Knobs: SALES=0 (paymentMode 'transfer' + 503 on POST /api/tickets, as on a
// server without the program), CONFIRM_PENDING=n (confirm / the order answer `pending` n times first, default 1). Shapes = the routes as built on paid-tickets @ b860f9d.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import web3 from '@solana/web3.js';
const { Keypair, PublicKey, SystemProgram, Transaction } = web3;
const PORT = +(process.env.PORT || 3150), SALES = process.env.SALES !== '0', PENDING = +(process.env.CONFIRM_PENDING ?? 1);
const ROOT = new URL('../..', import.meta.url).pathname, SITES = [path.join(ROOT, 'landing/dist'), path.join(ROOT, 'client')].filter(d => fs.existsSync(d));
const DAY = 86_400_000, NOW = () => Date.now(), SOL_USD = 118, B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sig = () => Array.from({ length: 88 }, () => B58[Math.floor(Math.random() * 58)]).join('');   // looks like a signature; it is not one
const addr = () => Keypair.generate().publicKey.toBase58();
const WALLET = Keypair.generate().publicKey, PROGRAM = addr(), TREASURY = { fee: addr(), seed: addr() };
// 30 riders so the lobby board can page (25 a page). They take turns on 1h / 4h / 8h. Index 11 is the signed-in wallet.
const BOARD_TIERS = ['1h', '4h', '8h'];
const BOARD_RIDERS = Array.from({ length: 30 }, (_, i) => ({ wallet: i === 11 ? WALLET.toBase58() : Keypair.generate().publicKey.toBase58(), tier: BOARD_TIERS[i % 3], distance: 80_000 - i * 1500, seconds: 4000 + (29 - i) * 90, hull: i === 4 ? null : 100 - (i % 35), rides: 1 + (i % 4) }));

/* ───── state ───── */
const t0 = NOW();
const mkPool = (id, tier, label, status, o) => ({ id, address: addr(), tier, label, status, priceLamports: 50_000_000, minTickets: 10, maxTickets: 0, maxPerWallet: 5, sold: 0, buyers: 0,
  prepDeadline: t0 + 6 * DAY, playDeadline: t0 + 13 * DAY, sponsoredLamports: 0, split: { prizeBps: 7000, seedBps: 2000, feeBps: 1000 }, treasuries: TREASURY, roundId: null,
  payout: { state: 'pending', note: null, held: false }, ...o, payoutAt: o.payoutAt ?? (o.playDeadline ?? t0 + 13 * DAY) + 2 * DAY });   // v2: a 48 h review window after the play deadline
const pools = [
  mkPool(1, '1h', '1H · demo pool', 'active', { minTickets: 2, sold: 5, buyers: 4 }),
  mkPool(2, '4h', '4H · week 42', 'open', { sold: 7, buyers: 6 }),
  mkPool(3, '8h', '8H · week 41', 'refunding', { priceLamports: 420_000_000, sold: 4, buyers: 3, prepDeadline: t0 - DAY, playDeadline: t0 + 6 * DAY }),
  mkPool(5, '4h', '4H · week 41', 'refunding', { sold: 3, buyers: 3, prepDeadline: t0 - 2 * DAY, playDeadline: t0 + 5 * DAY }),
];
const tickets = new Map([[1, { balance: 1, bought: 1 }], [2, { balance: 0, bought: 0 }], [3, { balance: 0, bought: 2 }], [5, { balance: 0, bought: 1 }]]);
const grants = [{ poolId: 3, delta: 2, source: 'payment', ref: sig(), at: t0 - 3 * DAY }, { poolId: 5, delta: 1, source: 'payment', ref: sig(), at: t0 - 4 * DAY }, { poolId: 1, delta: 1, source: 'promo', ref: 'WELCOME', at: t0 - DAY }];
const orders = new Map(), polls = new Map(), refunds = new Map(), rides = new Map();
let freeRides = 10;
const CATALOG = {   // = server/src/domain/economy/cosmetics.ts (the first item of a slot is its default)
  wheel: ['classic', 'crimson', 'ocean', 'moss', 'gold', 'ivory'], truck_color: ['red', 'blue', 'green', 'black', 'yellow', 'white', 'convoy', 'signal', 'amber'], gearbox: ['stick', 'chrome', 'wood', 'racing', 'gold', 'carbon'],
  dice: ['white', 'red', 'blue', 'gold', 'pink', 'black'], needle: ['orange', 'red', 'lime', 'cyan', 'white', 'gold'],
};
const redeemed = [], owned = Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, [v[0]]])), worn = Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, v[0]])), earned = {};   // promo codes: what this wallet redeemed + its parts
const wardrobeDto = () => ({ equipped: { ...worn }, unlocked: Object.fromEntries(Object.entries(owned).map(([k, v]) => [k, [...v]])) });
const garageDto = () => {
  const slots = Object.entries(CATALOG).map(([slot, ids]) => {
    const parts = ids.map((id, i) => ({ id, isDefault: i === 0, owned: owned[slot].includes(id), worn: worn[slot] === id, unlockedAt: earned[`${slot}:${id}`]?.at ?? null, code: earned[`${slot}:${id}`]?.code ?? null }));
    return { slot, parts, collected: parts.filter(p => !p.isDefault && p.owned).length, total: ids.length - 1 };
  });
  const collected = slots.reduce((n, x) => n + x.collected, 0), total = slots.reduce((n, x) => n + x.total, 0);
  return { equipped: { ...worn }, slots, progress: { collected, total, percent: Math.floor((collected * 100) / total) } };
};

const toGo = p => (p.status === 'open' ? Math.max(0, p.minTickets - p.sold) : 0);
const vault = p => (p.sold - (p.refundedTickets ?? 0)) * p.priceLamports + p.sponsoredLamports;   // the escrow: what is still in the vault
const poolDto = p => ({ ...p, toGo: toGo(p), progressPct: Math.min(100, Math.floor((p.sold / p.minTickets) * 100)), vaultLamports: vault(p), potLamports: p.sold * p.priceLamports + p.sponsoredLamports });
const onSale = tier => pools.find(p => p.tier === tier && (p.status === 'open' || p.status === 'active')) ?? pools.find(p => p.tier === tier) ?? null;
const ticketDto = id => { const p = pools.find(x => x.id === id), t = tickets.get(id); return { poolId: id, tier: p.tier, label: p.label, status: p.status, balance: t.balance, bought: t.bought, cap: p.maxPerWallet, refundable: p.status === 'refunding' && t.bought > 0, ridable: p.status === 'active' && NOW() < p.playDeadline, rideBy: (p.playDeadline ) - 3600_000}; };   // TicketBalanceDto: rideBy = the last start of a 1 h shift (the play deadline − 1 h, as the server's Pool.startBy)
const readyFree = () => { const r = [...rides.values()].find(x => x.status === 'created' && x.tier === 'free'); return r ? { id: r.id, level: r.level, trip: r.trip, tutorial: r.tutorial, assist: r.assist } : null; };   // MeDto.readyFreeRide: the free ride ordered, not started
const me = () => ({ wallet: WALLET.toBase58(), freeRides, freeRidesMax: 5, nextFreeRideAt: freeRides < 5 ? t0 + DAY : null, createdAt: t0 - 9 * DAY, tutorialPassed: false, agreements: { age18: true, loss: true }, demo: false, demoScale: 60, tickets: [...tickets.keys()].map(ticketDto), readyFreeRide: readyFree() });
const FREE_LEVELS = [   // = server/src/domain/rides/ride-trip.ts FREE_LEVELS at FREE_RIDE_SECONDS 180 (GET /api/tiers → the free tier's `levels`). route = that level's country.
  { level: 1, trip: 'free-1c', name: 'EASY', seconds: 180, completeDist: 1512, tutorial: true, assist: true, route: 'stuart' },
  { level: 2, trip: 'free-2c', name: 'MEDIUM', seconds: 300, completeDist: 3360, tutorial: true, assist: true, route: 'route66' },
  { level: 3, trip: 'free-3b', name: 'HARD', seconds: 900, completeDist: 10080, tutorial: false, assist: false, route: 'brenner' },
];
const TIERS = [{ id: 'free', usd: 0, seconds: 180, completeDist: 1512, onSale: true, levels: FREE_LEVELS }, { id: '1h', usd: 5, seconds: 3600, completeDist: 50400, onSale: true }, { id: '4h', usd: 15, seconds: 14400, completeDist: 201600, onSale: false }, { id: '8h', usd: 50, seconds: 28800, completeDist: 403200, onSale: false }];
const problem = (status, code, detail) => ({ status, body: { type: `/problems/${code}`, title: 'Error', status, code, detail } });
const tx = (lamports, to, feePayer) => {   // a real, unsigned legacy transaction (a plain transfer standing in for buy_ticket / refund); never sent anywhere
  const blockhash = Keypair.generate().publicKey.toBase58(), t = new Transaction({ feePayer, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: to, lamports }));
  return { transaction: t.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), message: t.serializeMessage().toString('base64'), blockhash, signatureHint: blockhash };
};
function pay(o) {   // the chain confirmed the order's payment: credit the tickets, move the pool (an open pool goes live at its minimum)
  const p = pools.find(x => x.id === o.poolId), t = tickets.get(o.poolId) ?? { balance: 0, bought: 0 }; tickets.set(o.poolId, t);
  t.balance += o.qty; t.bought += o.qty; p.sold += o.qty; if (p.status === 'open' && p.sold >= p.minTickets) p.status = 'active';
  o.status = 'paid'; o.paidAt = NOW(); grants.push({ poolId: p.id, delta: o.qty, source: 'payment', ref: o.signature, at: NOW() });
}

/* ───── routes: [method, regex, handler(match, body) → { status?, body }] ───── */
const R = [
  ['GET', /^me$/, () => ({ body: me() })],
  ['GET', /^profile$/, () => ({ body: { ...me(), career: { rides: 3, ridesFree: 1, ridesPaid: 2, ridesCompleted: 1, seconds: 190, metres: 4200, crashesVehicle: 0, crashesBuilding: 0, donations: 0, donationLamports: 0 }, stats: { rides: 3, completed: 1, metres: 4200, bestMetres: 4200, paidRides: 2, spentLamports: 940_000_000, ticketsBought: [...tickets.values()].reduce((a, t) => a + t.bought, 0) }, recent: [], achievements: [], grants: [...grants].sort((a, b) => b.at - a.at).slice(0, 20) } })],
  ['GET', /^tiers$/, () => ({ body: { solUsd: SOL_USD, treasury: TREASURY.fee, paymentMode: SALES ? 'program' : 'transfer', tiers: TIERS.map(t => { const p = t.id === 'free' ? null : onSale(t.id); return { ...t, lamports: p?.priceLamports ?? null, available: true, pool: p && poolDto(p) }; }) } })],
  ['GET', /^pool$/, () => ({ body: { round: { id: 1, startsAt: t0 - 3 * DAY, endsAt: t0 + 4 * DAY }, entries: 0, split: { entries: 0, carry: 0, grand: 0, top20: 0, nextSeed: 0, fees: 0 }, settled: false, solUsd: SOL_USD, usd: { grand: 0, top20: 0, nextSeed: 0, fees: 0, entries: 0 }, pools: pools.filter(p => p.status === 'open' || p.status === 'active').map(poolDto) } })],
  ['GET', /^pools$/, () => ({ body: { pools: pools.filter(p => p.status === 'open' || p.status === 'active').map(poolDto), finished: pools.filter(p => p.status === 'settled').map(poolDto) } })],
  ['GET', /^pools\/(\d+)\/standings$/, m => { const p = pools.find(x => x.id === +m[1]); return p ? { body: { poolId: p.id, tier: p.tier, label: p.label, playDeadline: p.playDeadline, payoutAt: p.payoutAt, prizeLamports: 0, final: false, payout: p.payout, underReview: 0, ranks: [] } } : problem(404, 'not_found', 'no such pool'); }],
  ['GET', /^pools\/(\d+)$/, m => { const p = pools.find(x => x.id === +m[1]); return p ? { body: poolDto(p) } : problem(404, 'not_found', 'no such pool'); }],
  ['GET', /^live$/, () => ({ body: { now: NOW(), rides: [], upcoming: [], recent: [], totals: { shifts: 1, metres: 4200, drivers: 1 } } })],
  ['GET', /^leaderboard$/, (m, b, q) => {   // board=free&level=1|2|3 (absent = 3 HARD); a level on a paid board = 400, as the server's query schema
    const board = q.get('board') === 'free' || q.get('board') === 'all' ? q.get('board') : 'round', lv = q.get('level'), tier = q.get('tier');
    if (lv != null && (board !== 'free' || !['1', '2', '3'].includes(lv))) return problem(400, 'validation_error', board !== 'free' ? 'level is for the free board only' : 'level must be one of 1, 2, 3');
    if (tier != null && (board === 'free' || !BOARD_TIERS.includes(tier))) return problem(400, 'validation_error', board === 'free' ? 'tier is for a paid board only' : 'tier must be one of 1h, 4h, 8h');
    const sort = q.get('sort') === 'time' || q.get('sort') === 'hull' || q.get('sort') === 'rides' ? q.get('sort') : 'distance';
    const page = Number(q.get('page') ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 4) return problem(400, 'validation_error', 'page must be 1..4');
    const by = { distance: r => r.distance, time: r => r.seconds, hull: r => r.hull ?? -1, rides: r => r.rides };
    const pool = board === 'free' || !tier ? BOARD_RIDERS : BOARD_RIDERS.filter(r => r.tier === tier);
    const ranked = [...pool].sort((a, b) => by[sort](b) - by[sort](a) || b.distance - a.distance);
    const mine = ranked.find(r => r.wallet === WALLET.toBase58());
    const at = ranked.indexOf(mine);
    const rows = ranked.slice((page - 1) * 25, Math.min(page * 25, 100)).map((r, i) => ({ rank: (page - 1) * 25 + i + 1, ...r }));
    const on = (list) => { const i = [...list].sort((a, b) => b.distance - a.distance).findIndex(r => r.wallet === WALLET.toBase58()); const r = i < 0 ? null : [...list].sort((a, b) => b.distance - a.distance)[i]; return { rank: i < 0 ? null : i + 1, distance: r?.distance ?? 0, seconds: r?.seconds ?? 0, hull: r?.hull ?? null, rides: r?.rides ?? 0 }; };
    const standing = [...BOARD_TIERS.map(t => ({ board: 'round', level: null, tier: t, ...on(BOARD_RIDERS.filter(r => r.tier === t)) })), ...BOARD_TIERS.map(t => ({ board: 'all', level: null, tier: t, ...on(BOARD_RIDERS.filter(r => r.tier === t)) })), ...[1, 2, 3].map(level => ({ board: 'free', level, tier: null, ...on(BOARD_RIDERS) }))];
    return { body: { board, level: board === 'free' ? Number(lv ?? 3) : null, tier: board === 'free' ? null : tier, round: { id: 1, endsAt: t0 + 4 * DAY }, prizeRanks: 20, verifiedOnly: false, sort, page, pageSize: 25, total: Math.min(ranked.length, 100), rows, me: mine ? { rank: at + 1, distance: mine.distance, seconds: mine.seconds, hull: mine.hull, rides: mine.rides } : null, standing: q.get('me') === '1' ? standing : null } };
  }],
  ['GET', /^rides\/pending$/, () => ({ body: { ride: [...rides.values()].find(r => r.status === 'awaiting_payment') ?? null } })],   // a ready free ride is not a pending payment (get-pending-ride.handler.ts)
  ['GET', /^rides\/([^/]+)$/, m => { const r = rides.get(m[1]); return r ? { body: r } : problem(404, 'not_found', 'no such ride'); }],
  ['POST', /^rides$/, (m, b) => {
    if (b.level !== undefined && !FREE_LEVELS.some(l => l.level === b.level)) return problem(400, 'validation_error', 'level must be one of 1, 2, 3');   // the real server's body schema refuses it before anything else
    const tier = b.tier, ready = tier === 'free' ? [...rides.values()].find(r => r.status === 'created' && r.tier === 'free') : null;
    const lv = tier === 'free' ? FREE_LEVELS.find(l => l.level === (b.level ?? ready?.level ?? 1)) : null;   // no level = the ready ride keeps its own
    if (tier !== 'free' && b.level != null) return problem(409, 'level_free_only', 'a level is for free rides only');
    if (lv?.level === 3 && b.assist) return problem(409, 'assist_not_allowed', 'the HARD free run has no assist');
    if (lv?.level === 3 && b.tutorial) return problem(409, 'tutorial_not_allowed', 'the HARD free run has no tutorial');
    if (ready) {   // asking for the ready free ride again re-chooses its level + helpers on that SAME ride – no second credit (create-ride.handler.ts)
      Object.assign(ready, { minSeconds: lv.seconds, completeDist: lv.completeDist, trip: lv.trip, level: lv.level, route: lv.route, tutorial: !!b.tutorial, assist: !!b.assist });
      return { body: ready };
    }
    if (tier === 'free') { if (freeRides <= 0) return problem(409, 'conflict', 'no free rides left'); freeRides--; } else {
      const held = pools.filter(p => p.tier === tier && tickets.get(p.id)?.balance > 0), live = held.find(p => p.status === 'active');
      if (!live) return held.length ? problem(409, 'pool_not_live', `pool not live yet – ${toGo(held[0])} more tickets needed`) : problem(409, 'no_tickets', `no ${tier} tickets left`);
      tickets.get(live.id).balance--; grants.push({ poolId: live.id, delta: -1, source: 'spend', ref: 'stub-ride', at: NOW() });
    }
    const r = { id: `stub-${rides.size + 1}`, tier, seed: 1, status: 'created', minSeconds: lv ? lv.seconds : 300, completeDist: lv ? lv.completeDist : 4200, trip: lv ? lv.trip : tier, level: lv?.level ?? null, route: lv?.route ?? 'route66', startHour: 12, tutorial: !!b.tutorial, assist: !!b.assist, timeScale: 1, priceUsd: 0, lamports: 0, quoteExpiresAt: null, roundId: 1, poolId: null, driveSeconds: 0, distance: 0, reason: null };
    rides.set(r.id, r); return { status: 201, body: r };
  }],
  ['POST', /^promo\/redeem$/, (m, b) => {   // STUB = 2 tickets · RIDES = +3 free rides (above the cap). A colour code is refused – cab parts are HONK burns.
    const code = String(b.code).replace(/\s+/g, '').toUpperCase();
    if (code === 'RIDES') { freeRides += 3; redeemed.unshift({ code, label: '3 free rides', description: 'Three extra rides', kind: 'free_rides', at: NOW() }); return { body: { kind: 'free_rides', code, label: '3 free rides', added: 3, freeRides } }; }
    if (code === 'GOLD' || code === 'BLUE' || code === 'RACING') return problem(409, 'visuals_are_honk', 'cab visuals are minted by burning HONK');
    if (code !== 'STUB') return problem(404, 'not_found', 'no such promo code');
    const t = tickets.get(1), add = Math.min(2, 5 - t.balance); t.balance += add; grants.push({ poolId: 1, delta: add, source: 'promo', ref: 'STUB', at: NOW() });
    redeemed.unshift({ code: 'STUB', label: '2 × 1h ride tickets', description: null, kind: 'tickets', at: NOW() });
    return { body: { kind: 'tickets', code: 'STUB', label: '2 × 1h ride tickets', poolId: 1, tier: '1h', added: add, balance: t.balance, cap: 5 } };
  }],
  ['POST', /^telemetry$/, () => ({ body: { enabled: false, accepted: 0, dropped: 0 } })],   // the pages' analytics relay (off here: the browser stops posting)
  ['GET', /^promo\/mine$/, () => ({ body: { redemptions: redeemed } })],
  ['GET', /^wardrobe$/, () => ({ body: wardrobeDto() })],
  ['POST', /^wardrobe\/equip$/, (m, b) => {
    if (!owned[b.slot]) return problem(400, 'bad_request', 'no such slot');
    if (!owned[b.slot].includes(b.item)) return problem(409, 'not_owned', 'you do not own this item – burn HONK in the garage to mint it');
    worn[b.slot] = b.item; return { body: wardrobeDto() };
  }],
  ['GET', /^garage$/, () => ({ body: garageDto() })],
  ['POST', /^garage\/loadout$/, (m, b) => {
    const picks = Object.entries(b.loadout ?? {});
    if (!picks.length || picks.some(([slot]) => !CATALOG[slot])) return problem(400, 'bad_cosmetic', 'pick at least one known part');
    if (picks.some(([slot, item]) => !CATALOG[slot].includes(item))) return problem(400, 'bad_cosmetic', 'no such part');
    if (picks.some(([slot, item]) => !owned[slot].includes(item))) return problem(409, 'not_owned', 'you do not own that part – burn HONK in the garage to mint it');
    for (const [slot, item] of picks) worn[slot] = item;
    return { body: garageDto() };
  }],
  ['POST', /^auth\/logout$/, () => ({ body: { ok: true } })],
  // ── W3 / W4 routes, shapes as built on paid-tickets @ b860f9d ──
  ['GET', /^chain\/fees$/, () => ({ body: { priorityMicrolamports: 0, computeUnits: 40_000, estimatedFeeLamports: 5_000, blockhashTtlSeconds: 60 } })],
  ['POST', /^tickets$/, (m, b) => {
    if (!SALES) return problem(503, 'service_unavailable', 'the pool program is not configured on this server');
    const p = pools.find(x => x.id === b.poolId), t = tickets.get(b.poolId);
    if (!p) return problem(404, 'not_found', 'no such pool');
    if (!(p.status === 'open' || p.status === 'active')) return problem(409, 'not_sellable', 'this pool does not sell tickets');
    if ((t?.bought ?? 0) + b.qty > p.maxPerWallet) return problem(409, 'not_sellable', `at most ${p.maxPerWallet} tickets per wallet`);
    const o = { id: `ord-${orders.size + 1}`, poolId: p.id, qty: b.qty, lamports: p.priceLamports * b.qty, status: 'awaiting_payment', createdAt: NOW(), expiresAt: NOW() + 3_600_000, paidAt: null, refundedAt: null, signature: null };
    orders.set(o.id, o); polls.set(o.id, 0); return { body: o };
  }],
  ['GET', /^tickets\/pending$/, () => ({ body: { order: [...orders.values()].find(o => o.status === 'awaiting_payment') ?? null } })],
  ['GET', /^tickets\/orders\/([\w-]+)$/, m => { const o = orders.get(m[1]); if (!o) return problem(404, 'not_found', 'no such order'); if (o.status === 'awaiting_payment' && o.signature && polls.get(o.id) >= PENDING) pay(o); else polls.set(o.id, polls.get(o.id) + 1); return { body: o }; }],
  ['GET', /^tickets\/orders\/([\w-]+)\/payment$/, (m) => { const o = orders.get(m[1]); if (!o) return problem(404, 'not_found', 'no such order'); if (o.status !== 'awaiting_payment') return problem(409, 'order_closed', `the order is ${o.status}`);
    const p = pools.find(x => x.id === o.poolId), t = tx(o.lamports, new PublicKey(p.address), WALLET);   // the wallet pays its own fee
    return { body: { orderId: o.id, mode: 'program', programId: PROGRAM, poolId: p.id, lamports: o.lamports, transaction: t.transaction, message: t.message, feePayer: WALLET.toBase58(), computeUnits: 40_000, priorityMicrolamports: 0, blockhash: t.blockhash, lastValidBlockHeight: 1 } }; }],
  ['POST', /^tickets\/orders\/([\w-]+)\/confirm$/, (m, b) => {
    const o = orders.get(m[1]); if (!o) return problem(404, 'not_found', 'no such order');
    if (typeof b.signature !== 'string' || !b.signature) return problem(400, 'transaction_invalid', 'no signature');
    o.signature ??= b.signature;
    if (o.status === 'awaiting_payment' && polls.get(o.id) >= PENDING) pay(o); else polls.set(o.id, polls.get(o.id) + 1);
    return { body: { status: o.status === 'paid' ? 'paid' : 'pending', order: o } };
  }],
  ['GET', /^pools\/(\d+)\/refund$/, m => { const p = pools.find(x => x.id === +m[1]), t = tickets.get(+m[1]);
    if (!p || p.status !== 'refunding') return problem(409, 'not_refundable', 'this pool is not refunding');
    if (!t?.bought) return problem(409, 'nothing_to_refund', 'nothing to refund for this wallet');
    const r = tx(t.bought * p.priceLamports, WALLET, WALLET); refunds.set(r.signatureHint, p.id);
    return { body: { poolId: p.id, needsFail: false, lamports: t.bought * p.priceLamports, transaction: r.transaction, message: r.message, feePayer: WALLET.toBase58(), lastValidBlockHeight: 1 } }; }],
  ['POST', /^chain\/settle$/, (m, b) => {   // the stub can't read a signature: any refund the wallet just sent is taken as landed (the last one built)
    const poolId = [...refunds.values()].pop(); if (poolId == null) return { body: { signature: b.signature, status: 'invalid', detail: 'not a pool program transaction', events: [] } };
    refunds.clear(); const p = pools.find(x => x.id === poolId), t = tickets.get(poolId);
    if (t.bought) { p.refundedTickets = (p.refundedTickets ?? 0) + t.bought; grants.push({ poolId, delta: 0, source: 'refund', ref: b.signature, at: NOW() }); t.bought = 0; }
    return { body: { signature: b.signature, status: 'done', detail: null, events: [{ index: 0, kind: 'Refunded', poolId, outcome: 'applied', orderId: null, detail: null }] } };
  }],
];

/* ───── server ───── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
function file(res, url) {
  const rel = decodeURIComponent(url.split('?')[0]).replace(/\/$/, '/index.html');
  for (const dir of SITES) {
    const f = path.join(dir, path.normalize(rel)); if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(res); return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
}
http.createServer(async (req, res) => {
  if (!req.url.startsWith('/api/')) return file(res, req.url);
  let raw = ''; for await (const c of req) raw += c;
  const [p, qs = ''] = req.url.slice(5).split('?'), body = raw ? JSON.parse(raw) : {}, query = new URLSearchParams(qs);
  let out = problem(404, 'not_found', `Cannot ${req.method} /api/${p}`);
  for (const [m, re, h] of R) { const hit = m === req.method && p.match(re); if (hit) { out = h(hit, body, query); break; } }
  res.writeHead(out.status ?? 200, { 'content-type': out.status >= 400 ? 'application/problem+json' : 'application/json' }); res.end(JSON.stringify(out.body));
}).listen(PORT, () => console.log(`stub API + site on http://localhost:${PORT}/lobby.html (wallet ${WALLET.toBase58()}, sales ${SALES}) – promo codes STUB (2 tickets) · RIDES (+3 free rides). Cab parts are minted by burning HONK, not by a code.`));
