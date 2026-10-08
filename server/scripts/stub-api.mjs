// A STUB of the API for front-end work on the ticket flows the real server can't show yet (docs/paid-tickets-plan.md §2.4, W5): pools in EVERY status (open, active,
// refunding – which the dev seeds can't make), and the provisional order / payment / confirm / submit / refund routes of W3/W4 with real (unsigned, never sent) web3.js
// transactions, so client/site/pay.js runs end to end against a fake wallet. Serves landing/dist at / (if built) and client/ like Nest. One signed-in wallet, no auth, all in memory.
// Nothing touches a network or a chain: the "chain" here is a counter. Usage (from server/): PORT=3150 node scripts/stub-api.mjs   then open http://localhost:3150/lobby.html
// Knobs: SPONSORED=0 (self-paid path), SALES=0 (ticket sales switched off, as on the real server today), CONFIRM_PENDING=n (confirm answers `pending` n times first, default 1).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import web3 from '@solana/web3.js';
const { Keypair, PublicKey, SystemProgram, Transaction } = web3;
const PORT = +(process.env.PORT || 3150), SPONSORED = process.env.SPONSORED !== '0', SALES = process.env.SALES !== '0', PENDING = +(process.env.CONFIRM_PENDING ?? 1);
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
const orders = new Map(), rides = new Map();
let freeRides = 5;

const toGo = p => (p.status === 'open' ? Math.max(0, p.minTickets - p.sold) : 0);
const vault = p => (p.sold - (p.refundedTickets ?? 0)) * p.priceLamports + p.sponsoredLamports;   // the escrow: what is still in the vault
const poolDto = p => ({ ...p, toGo: toGo(p), progressPct: Math.min(100, Math.floor((p.sold / p.minTickets) * 100)), vaultLamports: vault(p), potLamports: p.sold * p.priceLamports + p.sponsoredLamports });
const onSale = tier => pools.find(p => p.tier === tier && (p.status === 'open' || p.status === 'active')) ?? pools.find(p => p.tier === tier) ?? null;
const ticketDto = id => { const p = pools.find(x => x.id === id), t = tickets.get(id); return { poolId: id, tier: p.tier, label: p.label, status: p.status, balance: t.balance, bought: t.bought, cap: p.maxPerWallet, refundable: p.status === 'refunding' && t.bought > 0 }; };
const me = () => ({ wallet: WALLET.toBase58(), freeRides, freeRidesMax: 5, nextFreeRideAt: freeRides < 5 ? t0 + DAY : null, createdAt: t0 - 9 * DAY, demo: false, demoScale: 60, tickets: [...tickets.keys()].map(ticketDto) });
const TIERS = [{ id: 'free', usd: 0, seconds: 300, completeDist: 4200 }, { id: '1h', usd: 5, seconds: 3600, completeDist: 50400 }, { id: '4h', usd: 15, seconds: 14400, completeDist: 201600 }, { id: '8h', usd: 50, seconds: 28800, completeDist: 403200 }];
const problem = (status, code, detail) => ({ status, body: { type: `/problems/${code}`, title: 'Error', status, code, detail } });
const tx = (lamports, to, feePayer) => {   // a real, unsigned legacy transaction (a plain transfer standing in for buy_ticket / refund); never sent anywhere
  const t = new Transaction({ feePayer, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(SystemProgram.transfer({ fromPubkey: WALLET, toPubkey: to, lamports }));
  return t.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
};

/* ───── routes: [method, regex, handler(match, body) → { status?, body }] ───── */
const R = [
  ['GET', /^me$/, () => ({ body: me() })],
  ['GET', /^profile$/, () => ({ body: { ...me(), stats: { rides: 3, completed: 1, metres: 4200, bestMetres: 4200, paidRides: 2, spentLamports: 940_000_000 }, recent: [], achievements: [], grants: [...grants].sort((a, b) => b.at - a.at).slice(0, 20) } })],
  ['GET', /^tiers$/, () => ({ body: { solUsd: SOL_USD, treasury: TREASURY.fee, paymentMode: 'program', ticketSales: SALES, tiers: TIERS.map(t => { const p = t.id === 'free' ? null : onSale(t.id); return { ...t, lamports: p?.priceLamports ?? null, available: true, pool: p && poolDto(p) }; }) } })],
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
    const r = { id: `stub-${rides.size + 1}`, tier, seed: 1, status: 'created', minSeconds: 300, completeDist: 4200, timeScale: 1, priceUsd: 0, lamports: 0, quoteExpiresAt: null, roundId: 1, poolId: null, driveSeconds: 0, distance: 0, reason: null };
    rides.set(r.id, r); return { status: 201, body: r };
  }],
  ['POST', /^promo\/redeem$/, (m, b) => {
    if (String(b.code).toUpperCase() !== 'STUB') return problem(404, 'not_found', 'no such promo code');
    const t = tickets.get(1), add = Math.min(2, 5 - t.balance); t.balance += add; grants.push({ poolId: 1, delta: add, source: 'promo', ref: 'STUB', at: NOW() });
    return { body: { code: 'STUB', poolId: 1, tier: '1h', added: add, balance: t.balance, cap: 5 } };
  }],
  ['POST', /^auth\/logout$/, () => ({ body: { ok: true } })],
  // ── provisional W3 / W4 routes (§2.4) ──
  ['GET', /^chain\/fees$/, () => ({ body: { priorityMicrolamports: 0, computeUnits: 40_000, estimatedFeeLamports: 5_000, sponsored: SPONSORED, blockhashTtlSeconds: 60 } })],
  ['POST', /^tickets$/, (m, b) => {
    if (!SALES) return problem(503, 'service_unavailable', 'the chain is not configured on this server');
    const p = pools.find(x => x.id === b.poolId), t = tickets.get(b.poolId);
    if (!p || !(p.status === 'open' || p.status === 'active')) return problem(409, 'pool_not_open', 'this pool does not sell tickets');
    if ((t?.bought ?? 0) + b.qty > p.maxPerWallet) return problem(409, 'over_cap', `at most ${p.maxPerWallet} tickets per wallet`);
    const o = { id: `ord-${orders.size + 1}`, poolId: p.id, qty: b.qty, lamports: p.priceLamports * b.qty, status: 'awaiting_payment', paidAt: null, refundedAt: null, polls: 0 };
    orders.set(o.id, o); return { status: 201, body: o };
  }],
  ['GET', /^tickets\/pending$/, () => ({ body: { order: [...orders.values()].find(o => o.status === 'awaiting_payment') ?? null } })],
  ['GET', /^tickets\/orders\/([\w-]+)$/, m => (orders.has(m[1]) ? { body: orders.get(m[1]) } : problem(404, 'not_found', 'no such order'))],
  ['GET', /^tickets\/orders\/([\w-]+)\/payment$/, m => { const o = orders.get(m[1]); if (!o) return problem(404, 'not_found', 'no such order'); const p = pools.find(x => x.id === o.poolId);
    return { body: { mode: 'program', programId: PROGRAM, pool: p.address, lamports: o.lamports, blockhash: 'stub', lastValidBlockHeight: 1, transaction: tx(o.lamports, new PublicKey(p.address), SPONSORED ? SPONSOR : WALLET) } }; }],
  ['POST', /^tickets\/orders\/([\w-]+)\/submit$/, (m, b) => (orders.has(m[1]) && typeof b.signedTransaction === 'string' && Transaction.from(Buffer.from(b.signedTransaction, 'base64')) ? { body: { signature: sig() } } : problem(400, 'bad_request', 'not the transaction built for this order'))],
  ['POST', /^tickets\/orders\/([\w-]+)\/confirm$/, m => {
    const o = orders.get(m[1]); if (!o) return problem(404, 'not_found', 'no such order');
    if (o.status === 'paid') return { body: { status: 'paid', order: o, tickets: ticketDto(o.poolId) } };
    if (o.polls++ < PENDING) return { body: { status: 'pending' } };
    const p = pools.find(x => x.id === o.poolId), t = tickets.get(o.poolId) ?? { balance: 0, bought: 0 }; tickets.set(o.poolId, t);
    t.balance += o.qty; t.bought += o.qty; p.sold += o.qty; if (p.status === 'open' && p.sold >= p.minTickets) p.status = 'active';
    o.status = 'paid'; o.paidAt = NOW(); grants.push({ poolId: p.id, delta: o.qty, source: 'payment', ref: sig(), at: NOW() });
    return { body: { status: 'paid', order: o, tickets: ticketDto(o.poolId) } };
  }],
  ['GET', /^pools\/(\d+)\/refund$/, m => { const p = pools.find(x => x.id === +m[1]), t = tickets.get(+m[1]);
    if (!p || p.status !== 'refunding' || !t?.bought) return problem(409, 'not_refundable', 'nothing to refund in this pool');
    return { body: { transaction: tx(t.bought * p.priceLamports, WALLET, SPONSORED ? SPONSOR : WALLET), sponsored: SPONSORED } }; }],
  ['POST', /^pools\/(\d+)\/refund\/submit$/, m => { const t = tickets.get(+m[1]); if (!t?.bought) return problem(409, 'not_refundable', 'nothing to refund'); const p = pools.find(x => x.id === +m[1]); p.refundedTickets = (p.refundedTickets ?? 0) + t.bought; grants.push({ poolId: p.id, delta: 0, source: 'refund', ref: sig(), at: NOW() }); t.bought = 0; return { body: { signature: sig() } }; }],
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
  const p = req.url.slice(5).split('?')[0], body = raw ? JSON.parse(raw) : {};
  let out = problem(404, 'not_found', `Cannot ${req.method} /api/${p}`);
  for (const [m, re, h] of R) { const hit = m === req.method && p.match(re); if (hit) { out = h(hit, body); break; } }
  res.writeHead(out.status ?? 200, { 'content-type': out.status >= 400 ? 'application/problem+json' : 'application/json' }); res.end(JSON.stringify(out.body));
}).listen(PORT, () => console.log(`stub API + site on http://localhost:${PORT}/lobby.html (wallet ${WALLET.toBase58()}, sponsored ${SPONSORED}, sales ${SALES}) – promo code STUB`));
