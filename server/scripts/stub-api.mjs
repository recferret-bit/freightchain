// A STUB of the API for front-end work on the ticket flows without a chain (docs/paid-tickets-plan.md §2.4, W5): pools in EVERY status (open, active,
// refunding – which the dev seeds can't make), and the order / payment / confirm / submit / refund / settle routes of W3/W4 with real (unsigned, never sent) web3.js
// transactions, so client/site/pay.js runs end to end against a fake wallet. Serves landing/dist at / (if built) and client/ like Nest. One signed-in wallet, no auth, all in memory.
// Nothing touches a network or a chain: the "chain" here is a counter. Usage (from server/): PORT=3150 node scripts/stub-api.mjs   then open http://localhost:3150/lobby.html
// Knobs: SPONSORED=0 (self-paid path), SUBMIT_FAIL=1 (the sponsor refuses: the client must fall back to self-paid), SALES=0 (paymentMode 'transfer' + 503 on POST /api/tickets, as on a
// server without the program), CONFIRM_PENDING=n (confirm / the order answer `pending` n times first, default 1). Shapes = the routes as built on paid-tickets @ b860f9d.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import web3 from '@solana/web3.js';
const { Keypair, PublicKey, SystemProgram, Transaction } = web3;
const PORT = +(process.env.PORT || 3150), SPONSORED = process.env.SPONSORED !== '0', SALES = process.env.SALES !== '0', SUBMIT_FAIL = process.env.SUBMIT_FAIL === '1', PENDING = +(process.env.CONFIRM_PENDING ?? 1);
const ROOT = new URL('../..', import.meta.url).pathname, SITES = [path.join(ROOT, 'landing/dist'), path.join(ROOT, 'client')].filter(d => fs.existsSync(d));
const DAY = 86_400_000, NOW = () => Date.now(), SOL_USD = 118, B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sig = () => Array.from({ length: 88 }, () => B58[Math.floor(Math.random() * 58)]).join('');   // looks like a signature; it is not one
const addr = () => Keypair.generate().publicKey.toBase58();
const WALLET = Keypair.generate().publicKey, SPONSOR = Keypair.generate().publicKey, PROGRAM = addr(), TREASURY = { fee: addr(), seed: addr() };

/* ───── state ───── */
const t0 = NOW();
const mkPool = (id, tier, label, status, o) => ({ id, address: addr(), tier, label, status, priceLamports: 50_000_000, minTickets: 10, maxTickets: 0, maxPerWallet: 5, sold: 0, buyers: 0,
  prepDeadline: t0 + 6 * DAY, playDeadline: t0 + 13 * DAY, sponsoredLamports: 0, split: { prizeBps: 7000, seedBps: 2000, feeBps: 1000 }, treasuries: TREASURY, roundId: null, ...o });
const pools = [
  mkPool(1, '1h', '1H · demo pool', 'active', { minTickets: 2, sold: 5, buyers: 4 }),
  mkPool(2, '4h', '4H · week 42', 'open', { sold: 7, buyers: 6 }),
  mkPool(3, '8h', '8H · week 41', 'refunding', { priceLamports: 420_000_000, sold: 4, buyers: 3, prepDeadline: t0 - DAY, playDeadline: t0 + 6 * DAY }),
  mkPool(5, '4h', '4H · week 41', 'refunding', { sold: 3, buyers: 3, prepDeadline: t0 - 2 * DAY, playDeadline: t0 + 5 * DAY }),
];
const tickets = new Map([[1, { balance: 1, bought: 1 }], [2, { balance: 0, bought: 0 }], [3, { balance: 0, bought: 2 }], [5, { balance: 0, bought: 1 }]]);
const grants = [{ poolId: 3, delta: 2, source: 'payment', ref: sig(), at: t0 - 3 * DAY }, { poolId: 5, delta: 1, source: 'payment', ref: sig(), at: t0 - 4 * DAY }, { poolId: 1, delta: 1, source: 'promo', ref: 'WELCOME', at: t0 - DAY }];
const orders = new Map(), polls = new Map(), built = new Map(), refunds = new Map(), rides = new Map();
let freeRides = 5;
const CATALOG = {   // = server/src/domain/economy/cosmetics.ts (the first item of a slot is its default)
  wheel: ['classic', 'crimson', 'ocean', 'moss', 'gold', 'ivory'], truck_color: ['red', 'blue', 'green', 'black', 'yellow', 'white'], gearbox: ['stick', 'chrome', 'wood', 'racing', 'gold', 'carbon'],
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
const ticketDto = id => { const p = pools.find(x => x.id === id), t = tickets.get(id); return { poolId: id, tier: p.tier, label: p.label, status: p.status, balance: t.balance, bought: t.bought, cap: p.maxPerWallet, refundable: p.status === 'refunding' && t.bought > 0 }; };
const me = () => ({ wallet: WALLET.toBase58(), freeRides, freeRidesMax: 5, nextFreeRideAt: freeRides < 5 ? t0 + DAY : null, createdAt: t0 - 9 * DAY, demo: false, demoScale: 60, tickets: [...tickets.keys()].map(ticketDto) });
const TIERS = [{ id: 'free', usd: 0, seconds: 60, completeDist: 420, onSale: true }, { id: '1h', usd: 5, seconds: 3600, completeDist: 50400, onSale: true }, { id: '4h', usd: 15, seconds: 14400, completeDist: 201600, onSale: false }, { id: '8h', usd: 50, seconds: 28800, completeDist: 403200, onSale: false }];
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
  ['GET', /^profile$/, () => ({ body: { ...me(), stats: { rides: 3, completed: 1, metres: 4200, bestMetres: 4200, paidRides: 2, spentLamports: 940_000_000, ticketsBought: [...tickets.values()].reduce((a, t) => a + t.bought, 0) }, recent: [], achievements: [], grants: [...grants].sort((a, b) => b.at - a.at).slice(0, 20) } })],
  ['GET', /^tiers$/, () => ({ body: { solUsd: SOL_USD, treasury: TREASURY.fee, paymentMode: SALES ? 'program' : 'transfer', tiers: TIERS.map(t => { const p = t.id === 'free' ? null : onSale(t.id); return { ...t, lamports: p?.priceLamports ?? null, available: true, pool: p && poolDto(p) }; }) } })],
  ['GET', /^pool$/, () => ({ body: { round: { id: 1, startsAt: t0 - 3 * DAY, endsAt: t0 + 4 * DAY }, entries: 0, split: { entries: 0, carry: 0, grand: 0, top20: 0, nextSeed: 0, fees: 0 }, settled: false, solUsd: SOL_USD, usd: { grand: 0, top20: 0, nextSeed: 0, fees: 0, entries: 0 }, pools: pools.filter(p => p.status === 'open' || p.status === 'active').map(poolDto) } })],
  ['GET', /^pools$/, () => ({ body: { pools: pools.filter(p => p.status === 'open' || p.status === 'active').map(poolDto) } })],
  ['GET', /^pools\/(\d+)$/, m => { const p = pools.find(x => x.id === +m[1]); return p ? { body: poolDto(p) } : problem(404, 'not_found', 'no such pool'); }],
  ['GET', /^live$/, () => ({ body: { now: NOW(), rides: [], upcoming: [], recent: [], totals: { shifts: 1, metres: 4200, drivers: 1 } } })],
  ['GET', /^leaderboard/, () => ({ body: { board: 'round', round: { id: 1, endsAt: t0 + 4 * DAY }, prizeRanks: 20, rows: [] } })],
  ['GET', /^rides\/pending$/, () => ({ body: { ride: [...rides.values()].find(r => r.status === 'created') ?? null } })],
  ['POST', /^rides$/, (m, b) => {
    const tier = b.tier;
    if (tier === 'free') { if (freeRides <= 0) return problem(409, 'conflict', 'no free rides left'); freeRides--; } else {
      const held = pools.filter(p => p.tier === tier && tickets.get(p.id)?.balance > 0), live = held.find(p => p.status === 'active');
      if (!live) return held.length ? problem(409, 'pool_not_live', `pool not live yet – ${toGo(held[0])} more tickets needed`) : problem(409, 'no_tickets', `no ${tier} tickets left`);
      tickets.get(live.id).balance--; grants.push({ poolId: live.id, delta: -1, source: 'spend', ref: 'stub-ride', at: NOW() });
    }
    const r = { id: `stub-${rides.size + 1}`, tier, seed: 1, status: 'created', minSeconds: tier === 'free' ? 60 : 300, completeDist: tier === 'free' ? 420 : 4200, trip: tier, timeScale: 1, priceUsd: 0, lamports: 0, quoteExpiresAt: null, roundId: 1, poolId: null, driveSeconds: 0, distance: 0, reason: null };
    rides.set(r.id, r); return { status: 201, body: r };
  }],
  ['POST', /^promo\/redeem$/, (m, b) => {   // STUB = 2 tickets · RIDES = +3 free rides (above the cap) · GOLD / BLUE / RACING = a wheel / paint / shifter (a second try: 409 already_owned)
    const code = String(b.code).replace(/\s+/g, '').toUpperCase();
    if (code === 'RIDES') { freeRides += 3; redeemed.unshift({ code, label: '3 free rides', description: 'Three extra rides', kind: 'free_rides', at: NOW() }); return { body: { kind: 'free_rides', code, label: '3 free rides', added: 3, freeRides } }; }
    if (code === 'GOLD' || code === 'BLUE' || code === 'RACING') {
      const [slot, item] = { GOLD: ['wheel', 'gold'], BLUE: ['truck_color', 'blue'], RACING: ['gearbox', 'racing'] }[code];
      if (owned[slot].includes(item)) return problem(409, 'already_owned', 'you already own this item');
      owned[slot].push(item); worn[slot] = item; earned[`${slot}:${item}`] = { code, at: NOW() }; redeemed.unshift({ code, label: `${slot.replace('_', ' ')}: ${item}`, description: null, kind: 'cosmetic', at: NOW() });
      return { body: { kind: 'cosmetic', code, label: `${slot.replace('_', ' ')}: ${item}`, slot, item } };
    }
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
    if (!owned[b.slot].includes(b.item)) return problem(409, 'not_owned', 'you do not own this item – redeem a promo code for it');
    worn[b.slot] = b.item; return { body: wardrobeDto() };
  }],
  ['GET', /^garage$/, () => ({ body: garageDto() })],
  ['POST', /^garage\/loadout$/, (m, b) => {
    const picks = Object.entries(b.loadout ?? {});
    if (!picks.length || picks.some(([slot]) => !CATALOG[slot])) return problem(400, 'bad_cosmetic', 'pick at least one known part');
    if (picks.some(([slot, item]) => !CATALOG[slot].includes(item))) return problem(400, 'bad_cosmetic', 'no such part');
    if (picks.some(([slot, item]) => !owned[slot].includes(item))) return problem(409, 'not_owned', 'you do not own that part – redeem a promo code for it');
    for (const [slot, item] of picks) worn[slot] = item;
    return { body: garageDto() };
  }],
  ['POST', /^auth\/logout$/, () => ({ body: { ok: true } })],
  // ── W3 / W4 routes, shapes as built on paid-tickets @ b860f9d ──
  ['GET', /^chain\/fees$/, () => ({ body: { priorityMicrolamports: 0, computeUnits: 40_000, estimatedFeeLamports: 5_000, sponsored: SPONSORED, blockhashTtlSeconds: 60 } })],
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
  ['GET', /^tickets\/orders\/([\w-]+)\/payment$/, (m, b, q) => { const o = orders.get(m[1]); if (!o) return problem(404, 'not_found', 'no such order'); if (o.status !== 'awaiting_payment') return problem(409, 'order_closed', `the order is ${o.status}`);
    const p = pools.find(x => x.id === o.poolId), sponsored = SPONSORED && q.get('selfPaid') !== '1', feePayer = sponsored ? SPONSOR : WALLET, t = tx(o.lamports, new PublicKey(p.address), feePayer);
    built.set(o.id, t.message);   // /submit accepts exactly these message bytes (the real server's fee-payer-drain guard)
    return { body: { orderId: o.id, mode: 'program', programId: PROGRAM, poolId: p.id, lamports: o.lamports, transaction: t.transaction, message: t.message, feePayer: feePayer.toBase58(), sponsored, computeUnits: 40_000, priorityMicrolamports: 0, blockhash: t.blockhash, lastValidBlockHeight: 1 } }; }],
  ['POST', /^tickets\/orders\/([\w-]+)\/submit$/, (m, b) => {
    const o = orders.get(m[1]); if (!o) return problem(404, 'not_found', 'no such order');
    if (SUBMIT_FAIL) return problem(503, 'service_unavailable', 'the fee sponsor is empty');
    let msg = null; try { msg = Transaction.from(Buffer.from(String(b.signedTransaction), 'base64')).serializeMessage().toString('base64'); } catch { /* not a transaction */ }
    if (!msg || msg !== built.get(o.id)) return problem(400, 'transaction_mismatch', 'not the transaction built for this order');
    o.signature = sig(); pay(o); return { body: { signature: o.signature, status: 'paid', order: o } };
  }],
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
    return { body: { poolId: p.id, needsFail: false, lamports: t.bought * p.priceLamports, transaction: r.transaction, message: r.message, feePayer: WALLET.toBase58(), sponsored: false, lastValidBlockHeight: 1 } }; }],
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
}).listen(PORT, () => console.log(`stub API + site on http://localhost:${PORT}/lobby.html (wallet ${WALLET.toBase58()}, sponsored ${SPONSORED}, sales ${SALES}) – promo codes STUB (2 tickets) · RIDES (+3 free rides) · GOLD / BLUE / RACING (a wheel / truck paint / shifter)`));
