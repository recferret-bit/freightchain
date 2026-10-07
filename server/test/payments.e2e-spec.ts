import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import { Keypair, PublicKey, SystemProgram, Transaction, type ParsedTransactionWithMeta } from '@solana/web3.js';

/* Day 1: tiers + SOL quote, paying a ride on chain, the weekly prize pool, demo scale, leaderboards.
   The chain is a FAKE (parsed transactions we craft), the price is pinned (SOL_USD=100 → $5 = 0.05 SOL); a real devnet run is scripts/devnet-pay.mjs. */
const treasuryKp = Keypair.generate(), TREASURY = treasuryKp.publicKey.toBase58();
process.env.DB_PATH = ':memory:';
process.env.SOL_USD = '100';
process.env.TREASURY_PUBKEY = TREASURY;

let t = Date.UTC(2026, 9, 7, 12, 0, 0);   // a Wednesday
const clock = { now: () => t };
const sec = (n: number) => { t += n * 1000; };
const chainTxs = new Map<string, ParsedTransactionWithMeta>();
const chain = {
  latestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }),
  parsedTx: async (sig: string) => { fetched++; return chainTxs.get(sig) ?? null; },
  recentSignatures: async (address: string) => [...(history.get(address) ?? [])].reverse(),   // newest first, like getSignaturesForAddress
};
let fetched = 0;   // how many transactions were fetched in full
const history = new Map<string, { signature: string; memo: string | null }[]>();   // wallet → what it sent, with the RPC's memo rendering "[len] text"

let app: INestApplication;
let MEMO: PublicKey;
const wallet = () => { const kp = nacl.sign.keyPair(); return { kp, address: bs58.encode(kp.publicKey) }; };
const sign = (kp: nacl.SignKeyPair, m: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey));
async function login(w = wallet()) {
  const agent = request.agent(app.getHttpServer());
  const { body } = await agent.post('/api/auth/nonce').send({ wallet: w.address }).expect(200);
  await agent.post('/api/auth/verify').send({ wallet: w.address, signature: sign(w.kp, body.message) }).expect(200);
  return { agent, ...w };
}

interface TxOpts { payer: string; destination?: string; lamports?: number; memo?: string | null; err?: unknown; before?: unknown[]; source?: string }
/** a parsed transaction as getParsedTransaction returns it */
function parsedTx(o: TxOpts): ParsedTransactionWithMeta {
  const ixs: unknown[] = [...(o.before ?? [])];
  ixs.push({ program: 'system', programId: SystemProgram.programId, parsed: { type: 'transfer', info: { source: o.source ?? o.payer, destination: o.destination ?? TREASURY, lamports: o.lamports ?? 0 } } });
  if (o.memo !== null) ixs.push({ program: 'spl-memo', programId: MEMO, parsed: o.memo });
  return { slot: 1, blockTime: Math.floor(t / 1000), meta: { err: o.err ?? null }, transaction: { signatures: [], message: { recentBlockhash: '', accountKeys: [{ pubkey: new PublicKey(o.payer), signer: true, writable: true, source: 'transaction' }], instructions: ixs } } } as unknown as ParsedTransactionWithMeta;
}
const newSig = () => bs58.encode(randomBytes(64));
const computeBudget = { programId: new PublicKey('ComputeBudget111111111111111111111111111111'), accounts: [], data: '3DTZbgwcZoUj' };

beforeAll(async () => {
  const demo = wallet(); demoWallet = demo;
  process.env.DEMO_WALLETS = demo.address;
  const { AppModule } = await import('../src/app.module.js');
  const { ClockService } = await import('../src/clock.service.js');
  const { ChainService } = await import('../src/solana/chain.service.js');
  MEMO = (await import('../src/rides/payments.service.js')).MEMO_PROGRAM;
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ClockService).useValue(clock).overrideProvider(ChainService).useValue(chain).compile();
  app = mod.createNestApplication(); await app.init();
});
let demoWallet: { kp: nacl.SignKeyPair; address: string };
afterAll(() => app.close());

/** create an order and return it; optionally pay it on the fake chain */
async function order(a: Awaited<ReturnType<typeof login>>, tier = '1h') {
  return (await a.agent.post('/api/rides').send({ tier }).expect(200)).body;
}
function pay(a: { address: string }, ride: { id: string; lamports: number }, over: Partial<TxOpts> = {}) {
  const sig = newSig(); chainTxs.set(sig, parsedTx({ payer: a.address, lamports: ride.lamports, memo: ride.id, ...over }));
  const memo = over.memo === undefined ? ride.id : over.memo;
  history.set(a.address, [...(history.get(a.address) ?? []), { signature: sig, memo: memo === null ? null : `[${memo.length}] ${memo}` }]); return sig;
}

describe('tiers and the SOL quote', () => {
  it('lists the tiers with live lamports (pinned $100 → $5 = 0.05 SOL)', async () => {
    const { body } = await request(app.getHttpServer()).get('/api/tiers').expect(200);
    expect(body.solUsd).toBe(100);
    expect(body.treasury).toBe(TREASURY);
    expect(Object.fromEntries(body.tiers.map((x: { id: string; lamports: number | null }) => [x.id, x.lamports]))).toEqual({ free: null, '1h': 50_000_000, '4h': 150_000_000, '8h': 500_000_000 });
    expect(body.tiers.every((x: { available: boolean }) => x.available)).toBe(true);
  });

  it('an order locks lamports, price and an expiry; it cannot start until paid', async () => {
    const a = await login(), r = await order(a);
    expect(r).toMatchObject({ tier: '1h', status: 'awaiting_payment', lamports: 50_000_000, priceUsd: 5, timeScale: 1, minSeconds: 3600 });
    expect(r.quoteExpiresAt).toBe(t + 10 * 60_000);
    await a.agent.post(`/api/rides/${r.id}/start`).expect(409);
    await a.agent.post(`/api/rides/${r.id}/heartbeat`).send({ s: 0 }).expect(409);
  });

  it('the payment transaction pays the treasury the quoted amount with the ride id as memo', async () => {
    const a = await login(), r = await order(a, '4h');
    const p = (await a.agent.get(`/api/rides/${r.id}/payment`).expect(200)).body;
    expect(p).toMatchObject({ treasury: TREASURY, lamports: 150_000_000, memo: r.id });
    const tx = Transaction.from(Buffer.from(p.transaction, 'base64'));
    expect(tx.feePayer?.toBase58()).toBe(a.address);
    expect(tx.instructions).toHaveLength(2);
    expect(tx.instructions[0].programId.equals(SystemProgram.programId)).toBe(true);
    expect(tx.instructions[0].keys[1].pubkey.toBase58()).toBe(TREASURY);
    expect(tx.instructions[1].data.toString()).toBe(r.id);
  });
});

describe('verifying a payment', () => {
  it('pending until the transaction is visible, then paid; the order becomes a startable ride', async () => {
    const a = await login(), r = await order(a), sig = newSig();
    expect((await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(202)).body).toEqual({ status: 'pending' });
    chainTxs.set(sig, parsedTx({ payer: a.address, lamports: r.lamports, memo: r.id }));
    const ok = (await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(200)).body;
    expect(ok).toMatchObject({ status: 'paid', ride: { status: 'created', roundId: expect.any(Number) } });
    await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(200);   // idempotent
    await a.agent.post(`/api/rides/${r.id}/start`).expect(200);
  });

  it.each([
    ['too little', (a: { address: string }, r: { id: string; lamports: number }) => pay(a, r, { lamports: r.lamports - 1 })],
    ['wrong memo', (a: { address: string }, r: { id: string; lamports: number }) => pay(a, r, { memo: 'some-other-ride' })],
    ['no memo', (a: { address: string }, r: { id: string; lamports: number }) => pay(a, r, { memo: null })],
    ['wrong destination', (a: { address: string }, r: { id: string; lamports: number }) => pay(a, r, { destination: Keypair.generate().publicKey.toBase58() })],
    ['paid by someone else', (a: { address: string }, r: { id: string; lamports: number }) => pay(a, r, { payer: Keypair.generate().publicKey.toBase58() })],
    ['source is not the payer', (a: { address: string }, r: { id: string; lamports: number }) => pay(a, r, { source: Keypair.generate().publicKey.toBase58() })],
    ['failed on chain', (a: { address: string }, r: { id: string; lamports: number }) => pay(a, r, { err: { InstructionError: [0, 'Custom'] } })],
  ])('rejects: %s', async (_name, make) => {
    const a = await login(), r = await order(a), sig = make(a, r);
    await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(400);
    expect((await a.agent.get(`/api/rides/${r.id}`)).body.status).toBe('awaiting_payment');
  });

  it('accepts extra instructions around the transfer (compute budget etc.) and an overpayment', async () => {
    const a = await login(), r = await order(a);
    const sig = pay(a, r, { before: [computeBudget], lamports: r.lamports + 5 });
    await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(200);
  });

  it('one transaction pays for one ride only', async () => {
    const a = await login(), r1 = await order(a);
    const sig = pay(a, r1);
    await a.agent.post(`/api/rides/${r1.id}/confirm`).send({ signature: sig }).expect(200);
    await a.agent.post(`/api/rides/${r1.id}/start`); await a.agent.post(`/api/rides/${r1.id}/end`).send({ outcome: 'failed', s: 0 });
    const r2 = await order(a, '1h');
    chainTxs.set(sig, parsedTx({ payer: a.address, lamports: r2.lamports, memo: r2.id }));   // even a transaction that (impossibly) matches ride 2
    await a.agent.post(`/api/rides/${r2.id}/confirm`).send({ signature: sig }).expect(409);
    await a.agent.post(`/api/rides/${r1.id}/confirm`).send({ signature: pay(a, r1) }).expect(409);   // and a ride is paid once
  });

  it('honours a matching payment that lands after the quote expired, but hands out no new transaction', async () => {
    const a = await login(), r = await order(a), sig = pay(a, r);
    sec(11 * 60);
    await a.agent.get(`/api/rides/${r.id}/payment`).expect(409);
    await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(200);
    expect((await a.agent.get(`/api/rides/${r.id}`)).body.status).toBe('created');
  });

  it("is the buyer's own: another wallet can neither see nor pay the ride", async () => {
    const a = await login(), b = await login(), r = await order(a);
    await b.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: pay(b, r) }).expect(404);
    await b.agent.get(`/api/rides/${r.id}/payment`).expect(404);
  });
});

describe('a payment whose confirm call never arrived', () => {
  it('is found in the wallet history: reconcile credits the order (even after it expired), and /pending shows what is owed', async () => {
    const a = await login(), r = await order(a);
    expect((await a.agent.get('/api/rides/pending').expect(200)).body.ride).toMatchObject({ id: r.id, status: 'awaiting_payment' });
    expect((await a.agent.post(`/api/rides/${r.id}/reconcile`).expect(200)).body.status).toBe('not_found');   // nothing sent yet
    pay(a, r);                       // the wallet sent it, the tab died before /confirm
    sec(30 * 60);                    // …and the quote lapsed meanwhile
    await order(a, '4h');            // (re-ordering must not lose the earlier payment)
    expect((await a.agent.post(`/api/rides/${r.id}/reconcile`).expect(200)).body).toMatchObject({ status: 'paid', ride: { id: r.id, status: 'created' } });
    expect((await a.agent.post(`/api/rides/${r.id}/reconcile`).expect(200)).body.status).toBe('paid');         // idempotent
    expect((await a.agent.get('/api/rides/pending').expect(200)).body.ride).toMatchObject({ id: r.id, status: 'created' });
  });

  it('picks the payment out of a busy wallet by its memo and fetches only that transaction', async () => {
    const a = await login(), r = await order(a), other = await order(a, '4h');   // `other` replaces `r`: two orders, only r is paid below
    const rr = (await a.agent.get(`/api/rides/${r.id}`)).body; expect(rr.status).toBe('expired');
    const mine = pay(a, r);                                  // the matching payment, then lots of unrelated traffic after it (newer)
    for (let i = 0; i < 4; i++) pay(a, other, { lamports: 1 });   // memos name the OTHER ride
    history.get(a.address)!.push({ signature: newSig(), memo: null }, { signature: newSig(), memo: '[5] hello' });
    fetched = 0;
    expect((await a.agent.post(`/api/rides/${r.id}/reconcile`).expect(200)).body.status).toBe('paid');
    expect(fetched).toBe(1);
    expect(chainTxs.has(mine)).toBe(true);
  });

  it('ignores transactions that do not pay this order, and other wallets', async () => {
    const a = await login(), b = await login(), r = await order(a);
    pay(a, r, { lamports: r.lamports - 1 }); pay(a, r, { memo: 'other' }); pay(a, r, { memo: null });
    expect((await a.agent.post(`/api/rides/${r.id}/reconcile`).expect(200)).body.status).toBe('not_found');
    await b.agent.post(`/api/rides/${r.id}/reconcile`).expect(404);
    expect((await b.agent.get('/api/rides/pending').expect(200)).body.ride).toBeNull();
  });
});

describe('one open ride at a time', () => {
  it('re-asking returns the same order; another tier replaces it; a paid unstarted ride is never lost', async () => {
    const a = await login(), r1 = await order(a, '1h');
    expect((await order(a, '1h')).id).toBe(r1.id);
    const r2 = await order(a, '4h');
    expect(r2.id).not.toBe(r1.id);
    expect((await a.agent.get(`/api/rides/${r1.id}`)).body.status).toBe('expired');
    await a.agent.post(`/api/rides/${r2.id}/confirm`).send({ signature: pay(a, r2) }).expect(200);
    const again = await order(a, 'free');   // asks for a free ride, owns a paid unstarted one → gets that one back
    expect(again).toMatchObject({ id: r2.id, tier: '4h', status: 'created' });
  });

  it('the free path is unchanged: no payment, 5 credits, never scaled', async () => {
    const a = await login(), r = await order(a, 'free');
    expect(r).toMatchObject({ tier: 'free', status: 'created', timeScale: 1, lamports: 0, minSeconds: 180 });
    expect((await a.agent.get('/api/me')).body.freeRides).toBe(4);
  });
});

describe('demo scale', () => {
  it('shortens paid rides for allow-listed wallets only (and tells the client)', async () => {
    const d = await login(demoWallet), o = await login();
    expect(await order(d, '1h')).toMatchObject({ timeScale: 60, minSeconds: 60, completeDist: 840 });
    expect(await order(o, '1h')).toMatchObject({ timeScale: 1, minSeconds: 3600 });
  });
});

describe('prize pool, rounds and leaderboards', () => {
  it('counts paid entries and splits 50 / 20 / 20 / 10 exactly; the next week is seeded with the 20 %', async () => {
    const before = (await request(app.getHttpServer()).get('/api/pool').expect(200)).body;
    const a = await login();
    for (const tier of ['1h', '8h']) {
      const r = await order(a, tier);
      await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: pay(a, r) }).expect(200);
      await a.agent.post(`/api/rides/${r.id}/start`).expect(200);
      sec(2); await a.agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'failed', s: 0, reason: 'x' }).expect(200);   // a failed ride still counts as an entry
    }
    const pool = (await request(app.getHttpServer()).get('/api/pool').expect(200)).body;
    const gained = pool.split.entries - before.split.entries;
    expect(gained).toBe(550_000_000);
    expect(pool.entries - before.entries).toBe(2);
    const s = pool.split;
    expect(s.grand - s.carry + s.top20 + s.nextSeed + s.fees).toBe(s.entries);
    expect(s.top20).toBe(Math.floor(s.entries * 0.2));
    expect(pool.usd.entries).toBeCloseTo((s.entries / 1e9) * 100, 1);
    expect(pool.settled).toBe(false);

    sec(8 * 86_400);   // next week
    const next = (await request(app.getHttpServer()).get('/api/pool').expect(200)).body;
    expect(next.round.id).toBe(pool.round.id + 1);
    expect(next.split).toMatchObject({ entries: 0, carry: s.nextSeed, grand: s.nextSeed });
  });

  it('ranks completed paid rides by distance this round; free rides have their own board', async () => {
    const d = await login(demoWallet);
    const r = await order(d, '1h');   // demo: 60 s / 840 m
    await d.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: pay(d, r) }).expect(200);
    await d.agent.post(`/api/rides/${r.id}/start`).expect(200);
    for (let i = 1; i <= 7; i++) { sec(10); await d.agent.post(`/api/rides/${r.id}/heartbeat`).send({ s: i * 130, t: i * 10, hull: 100 }).expect(200); }
    expect((await d.agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'shift', s: 910, t: 70, hull: 100 }).expect(200)).body.status).toBe('completed');
    const board = (await request(app.getHttpServer()).get('/api/leaderboard').expect(200)).body;
    expect(board.board).toBe('round');
    expect(board.rows[0]).toMatchObject({ rank: 1, wallet: d.address, distance: 910, rides: 1 });
    expect((await request(app.getHttpServer()).get('/api/leaderboard?board=free').expect(200)).body.rows.every((x: { wallet: string }) => x.wallet !== d.address)).toBe(true);
  });
});
