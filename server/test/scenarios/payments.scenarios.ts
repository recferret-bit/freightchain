import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { newSignature, TREASURY, type PaymentOptions } from '../support/fake-chain.js';
import { bindClient, newWallet, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { recording, upload } from '../support/recording.js';
import { setTierOnSaleForTest } from '../../src/domain/rides/ride-tier.js';

/* Tiers + SOL quote, paying a ride on chain, the weekly prize pool, demo scale, leaderboards. The chain is a FAKE (transactions we craft),
   the price is pinned (SOL_USD=100 → $5 = 0.05 SOL); a real devnet run is scripts/devnet-pay.mjs. */
export const DEMO_WALLET = newWallet();
export const PAYMENTS_ENV = { DEMO_WALLETS: DEMO_WALLET.address, CHALLENGE_INTERVAL_SECONDS: '0' }; // no dispatch prompts here: verdict.scenarios.ts is where they are answered / ignored

interface Order {
  id: string;
  lamports: number;
}

export function paymentScenarios(h: () => Harness): void {
  const { anon, login, sec, now } = bindClient(h);
  beforeEach(() => { setTierOnSaleForTest('1h', false); return h().reset(); });
  afterEach(() => setTierOnSaleForTest('1h', false));

  /** create an order. 1h is off the product table; these cases opt it back on to exercise pay-per-ride. */
  const order = async (a: Rider, tier = '1h') => {
    if (tier === '1h') setTierOnSaleForTest('1h', true);
    return (await a.agent.post('/api/rides').send({ tier }).expect(200)).body;
  };
  /** a matching payment on the fake chain (override pieces to make it wrong); returns its signature */
  const pay = (a: { address: string }, ride: Order, over: Partial<PaymentOptions> = {}) =>
    h().chain.addPayment({ payer: a.address, lamports: ride.lamports, memo: over.memo === undefined ? ride.id : over.memo, ...over });

  describe('tiers and the SOL quote', () => {
    it('lists the tiers; a paid shift with no pool has no lamport price and is not on sale', async () => {
      const { body } = await anon().get('/api/tiers').expect(200);
      expect(body.solUsd).toBe(100);
      expect(body.treasury).toBe(TREASURY);
      expect(Object.fromEntries(body.tiers.map((x: { id: string; lamports: number | null }) => [x.id, x.lamports]))).toEqual({ free: null, '1h': null, '4h': null, '8h': null });
      expect(body.tiers.map((x: { id: string; available: boolean; onSale: boolean }) => [x.id, x.available, x.onSale])).toEqual([['free', true, true], ['1h', false, false], ['4h', false, false], ['8h', false, false]]);
    });

    it('POST /api/rides for the 1-hour shift with no pool is refused', async () => {
      const a = await login();
      expect((await a.agent.post('/api/rides').send({ tier: '1h' }).expect(409)).body.code).toBe('tier_not_on_sale');
    });

    it('an order locks lamports, price and an expiry; it cannot start until paid', async () => {
      const a = await login(), r = await order(a);
      expect(r).toMatchObject({ tier: '1h', status: 'awaiting_payment', lamports: 50_000_000, priceUsd: 5, timeScale: 1, minSeconds: 3600 });
      expect(r.quoteExpiresAt).toBe(now() + 10 * 60_000);
      await a.agent.post(`/api/rides/${r.id}/start`).expect(409);
      await a.agent.post(`/api/rides/${r.id}/heartbeat`).send({ s: 0 }).expect(409);
    });

    it('one road a day: every order of a tier on a UTC day gets that day\'s seed (route, start hour, holes); the next day a new one; free rides their own', async () => {
      const [a, b, c] = [await login(), await login(), await login()];
      const ra = await order(a), rb = await order(b);
      expect(rb).toMatchObject({ seed: ra.seed, route: ra.route, startHour: ra.startHour, trip: ra.trip });
      const free = (await c.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      expect(free.seed).not.toBe(ra.seed);
      sec(24 * 3600); // the next UTC day (the order of b lapsed long ago)
      expect((await order(b)).seed).not.toBe(ra.seed);
    });

    it('the payment transaction pays the treasury the quoted amount with the ride id as memo', async () => {
      const a = await login(), r = await order(a, '1h');
      const p = (await a.agent.get(`/api/rides/${r.id}/payment`).expect(200)).body;
      expect(p).toMatchObject({ treasury: TREASURY, lamports: 50_000_000, memo: r.id });
      const tx = Transaction.from(Buffer.from(p.transaction, 'base64'));
      expect(tx.feePayer?.toBase58()).toBe(a.address);
      expect(tx.instructions).toHaveLength(2);
      expect(tx.instructions[0]?.programId.equals(SystemProgram.programId)).toBe(true);
      expect(tx.instructions[0]?.keys[1]?.pubkey.toBase58()).toBe(TREASURY);
      expect(tx.instructions[1]?.data.toString()).toBe(r.id);
    });
  });

  describe('verifying a payment', () => {
    it('pending until the transaction is visible, then paid; the order becomes a startable ride', async () => {
      const a = await login(), r = await order(a), sig = newSignature();
      expect((await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(200)).body).toEqual({ status: 'pending' });
      h().chain.txs.set(sig, { outcome: 'success', feePayer: a.address, feePayerSigned: true, transfers: [{ source: a.address, destination: TREASURY, lamports: r.lamports }], memos: [r.id] });
      const ok = (await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(200)).body;
      expect(ok).toMatchObject({ status: 'paid', ride: { status: 'created', roundId: expect.any(Number) } });
      await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(200); // idempotent
      await a.agent.post(`/api/rides/${r.id}/start`).expect(200);
    });

    it.each([
      ['too little', (a: Rider, r: Order) => pay(a, r, { lamports: r.lamports - 1 })],
      ['wrong memo', (a: Rider, r: Order) => pay(a, r, { memo: 'some-other-ride' })],
      ['no memo', (a: Rider, r: Order) => pay(a, r, { memo: null })],
      ['wrong destination', (a: Rider, r: Order) => pay(a, r, { destination: Keypair.generate().publicKey.toBase58() })],
      ['paid by someone else', (a: Rider, r: Order) => pay(a, r, { payer: Keypair.generate().publicKey.toBase58(), feePayer: Keypair.generate().publicKey.toBase58() })],
      ['source is not the payer', (a: Rider, r: Order) => pay(a, r, { source: Keypair.generate().publicKey.toBase58() })],
      ['failed on chain', (a: Rider, r: Order) => pay(a, r, { outcome: 'failed' })],
      ['no metadata', (a: Rider, r: Order) => pay(a, r, { outcome: 'no_metadata' })],
    ])('rejects: %s', async (_name, make) => {
      const a = await login(), r = await order(a), sig = make(a, r);
      const res = await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(400);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({ status: 400, code: 'bad_request' });
      expect((await a.agent.get(`/api/rides/${r.id}`)).body.status).toBe('awaiting_payment');
    });

    it('accepts extra instructions around the transfer (compute budget etc.) and an overpayment', async () => {
      const a = await login(), r = await order(a);
      const sig = pay(a, r, { extraTransfers: [{ source: a.address, destination: Keypair.generate().publicKey.toBase58(), lamports: 1 }], lamports: r.lamports + 5 });
      await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(200);
    });

    it('a malformed signature is a validation error', async () => {
      const a = await login(), r = await order(a);
      const res = await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: 'not-a-signature' }).expect(400);
      expect(res.body).toMatchObject({ code: 'validation_error', errors: [{ path: 'signature' }] });
    });

    it('one transaction pays for one ride only', async () => {
      const a = await login(), r1 = await order(a);
      const sig = pay(a, r1);
      await a.agent.post(`/api/rides/${r1.id}/confirm`).send({ signature: sig }).expect(200);
      await a.agent.post(`/api/rides/${r1.id}/start`);
      await a.agent.post(`/api/rides/${r1.id}/end`).send({ outcome: 'failed', s: 0 });
      const r2 = await order(a, '1h');
      h().chain.txs.set(sig, { outcome: 'success', feePayer: a.address, feePayerSigned: true, transfers: [{ source: a.address, destination: TREASURY, lamports: r2.lamports }], memos: [r2.id] }); // even a transaction that (impossibly) matches ride 2
      await a.agent.post(`/api/rides/${r2.id}/confirm`).send({ signature: sig }).expect(409);
      await a.agent.post(`/api/rides/${r1.id}/confirm`).send({ signature: pay(a, r1) }).expect(409); // and a ride is paid once
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
      expect((await a.agent.post(`/api/rides/${r.id}/reconcile`).expect(200)).body.status).toBe('not_found'); // nothing sent yet
      pay(a, r); // the wallet sent it, the tab died before /confirm
      sec(30 * 60); // …and the quote lapsed meanwhile
      await order(a, '1h'); // the quote lapsed; a new 1h order must not lose the earlier payment
      expect((await a.agent.post(`/api/rides/${r.id}/reconcile`).expect(200)).body).toMatchObject({ status: 'paid', ride: { id: r.id, status: 'created' } });
      expect((await a.agent.post(`/api/rides/${r.id}/reconcile`).expect(200)).body.status).toBe('paid'); // idempotent
      expect((await a.agent.get('/api/rides/pending').expect(200)).body.ride).toMatchObject({ id: r.id, status: 'created' });
    });

    it('picks the payment out of a busy wallet by its memo and fetches only that transaction', async () => {
      const a = await login(), r = await order(a); sec(11 * 60); const other = await order(a); // the quote lapsed: `other` is a new 1h, `r` expired; only r is paid below
      expect((await a.agent.get(`/api/rides/${r.id}`)).body.status).toBe('expired');
      const chain = h().chain;
      pay(a, r); // the matching payment, then lots of unrelated traffic after it (newer)
      for (let i = 0; i < 4; i++) pay(a, other, { lamports: 1 }); // memos name the OTHER ride
      chain.addHistory(a.address, newSignature(), null);
      chain.addHistory(a.address, newSignature(), 'hello');
      chain.fetched = 0;
      expect((await a.agent.post(`/api/rides/${r.id}/reconcile`).expect(200)).body.status).toBe('paid');
      expect(chain.fetched).toBe(1);
    });

    it('a reference key finds a payment that is not in the wallet history, and a second reconcile stays paid', async () => {
      const a = await login(), r = await order(a);
      const p = (await a.agent.get(`/api/rides/${r.id}/payment`).expect(200)).body;
      expect(typeof p.reference).toBe('string');
      expect((await a.agent.get(`/api/rides/${r.id}/payment`).expect(200)).body.reference).toBe(p.reference);
      const link = await anon().get(`/api/solana-pay/rides/${r.id}`).expect(200);
      expect(link.body).toMatchObject({ label: 'Freight Chain' });
      expect(String(link.body.icon)).toMatch(/\/icons\/icon-512\.png$/);
      await anon().post(`/api/solana-pay/rides/${r.id}`).send({ account: Keypair.generate().publicKey.toBase58() }).expect(404);
      const phone = await anon().post(`/api/solana-pay/rides/${r.id}`).send({ account: a.address }).expect(200);
      expect(phone.body.message).toMatch(/devnet/);
      expect(typeof phone.body.transaction).toBe('string');
      for (let i = 0; i < 30; i++) h().chain.addHistory(a.address, newSignature(), 'noise');
      h().chain.addPayment({ payer: a.address, lamports: r.lamports, memo: r.id, reference: p.reference });
      h().chain.history.set(a.address, []); // the wallet's own history does not contain it; the reference index does
      expect((await a.agent.post(`/api/rides/${r.id}/reconcile`).expect(200)).body).toMatchObject({ status: 'paid', ride: { id: r.id, status: 'created' } });
      expect((await a.agent.post(`/api/rides/${r.id}/reconcile`).expect(200)).body.status).toBe('paid');
    });

    it('ignores transactions that do not pay this order, and other wallets', async () => {
      const a = await login(), b = await login(), r = await order(a);
      pay(a, r, { lamports: r.lamports - 1 });
      pay(a, r, { memo: 'other' });
      pay(a, r, { memo: null });
      expect((await a.agent.post(`/api/rides/${r.id}/reconcile`).expect(200)).body.status).toBe('not_found');
      await b.agent.post(`/api/rides/${r.id}/reconcile`).expect(404);
      expect((await b.agent.get('/api/rides/pending').expect(200)).body.ride).toBeNull();
    });
  });

  describe('a late payment never gives the wallet two rides in hand (review finding)', () => {
    it('order lapses → a free ride replaces it → the late payment lands: the free ride is cancelled, its credit refunded, ONE ride left', async () => {
      const a = await login(), o = await order(a, '1h');
      const sig = pay(a, o);
      const free = (await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body; // lets the unpaid order lapse
      expect((await a.agent.get(`/api/rides/${o.id}`)).body.status).toBe('expired');
      expect((await a.agent.get('/api/me')).body.freeRides).toBe(9);
      const paid = (await a.agent.post(`/api/rides/${o.id}/confirm`).send({ signature: sig }).expect(200)).body;
      expect(paid).toMatchObject({ status: 'paid', ride: { id: o.id, status: 'created' } });
      expect((await a.agent.get(`/api/rides/${free.id}`)).body.status).toBe('cancelled');
      expect((await a.agent.get('/api/me')).body.freeRides).toBe(10);
      expect((await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body.id).toBe(o.id); // the paid ride is the one in hand
      await a.agent.post(`/api/rides/${free.id}/start`).expect(409);
      await a.agent.post(`/api/rides/${o.id}/start`).expect(200);
    });

    it('two paid rides are both kept – but only one runs at a time', async () => {
      const a = await login(), first = await order(a, '1h');
      const sigFirst = pay(a, first);
      sec(11 * 60);
      const second = await order(a, '1h'); // the quote lapsed, so this is a second order
      await a.agent.post(`/api/rides/${second.id}/confirm`).send({ signature: pay(a, second) }).expect(200);
      await a.agent.post(`/api/rides/${first.id}/confirm`).send({ signature: sigFirst }).expect(200); // late payment: both are owed
      await a.agent.post(`/api/rides/${second.id}/start`).expect(200);
      const blocked = await a.agent.post(`/api/rides/${first.id}/start`).expect(409);
      expect(blocked.body.detail).toBe('another ride is in progress');
      sec(2);
      await a.agent.post(`/api/rides/${second.id}/end`).send({ outcome: 'failed', s: 0 }).expect(200);
      await a.agent.post(`/api/rides/${first.id}/start`).expect(200);
    });

    it('a lapsed order paid late keeps no stale end time', async () => {
      const a = await login(), o = await order(a, '1h');
      const sig = pay(a, o);
      sec(11 * 60);
      await a.agent.post(`/api/rides/${o.id}/start`).expect(409); // not paid yet
      await a.agent.post(`/api/rides/${o.id}/confirm`).send({ signature: sig }).expect(200);
      await a.agent.post(`/api/rides/${o.id}/start`).expect(200);
      expect((await a.agent.get('/api/profile')).body.recent[0]).toMatchObject({ status: 'running', endedAt: null });
    });
  });

  describe('one open ride at a time', () => {
    it('re-asking returns the same order; an off-sale tier leaves it; a lapsed quote is replaced; a paid unstarted ride is never lost', async () => {
      const a = await login(), r1 = await order(a, '1h');
      expect((await order(a, '1h')).id).toBe(r1.id);
      expect((await a.agent.post('/api/rides').send({ tier: '4h' }).expect(409)).body.code).toBe('tier_not_on_sale');
      expect((await a.agent.post('/api/rides').send({ tier: '8h' }).expect(409)).body.code).toBe('tier_not_on_sale');
      expect((await a.agent.get(`/api/rides/${r1.id}`)).body.status).toBe('awaiting_payment');
      sec(11 * 60);
      const r2 = await order(a, '1h');
      expect(r2.id).not.toBe(r1.id);
      expect((await a.agent.get(`/api/rides/${r1.id}`)).body.status).toBe('expired');
      await a.agent.post(`/api/rides/${r2.id}/confirm`).send({ signature: pay(a, r2) }).expect(200);
      const again = await order(a, 'free'); // asks for a free ride, owns a paid unstarted one → gets that one back
      expect(again).toMatchObject({ id: r2.id, tier: '1h', status: 'created' });
    });

    it('the free path is unchanged: no payment, 10 credits, never scaled', async () => {
      const a = await login(), r = await order(a, 'free');
      expect(r).toMatchObject({ tier: 'free', status: 'created', timeScale: 1, lamports: 0, minSeconds: 180 });
      expect((await a.agent.get('/api/me')).body.freeRides).toBe(9);
    });
  });

  describe('demo scale', () => {
    it('shortens paid rides for allow-listed wallets only (and tells the client)', async () => {
      const d = await login(DEMO_WALLET), o = await login();
      expect(await order(d, '1h')).toMatchObject({ timeScale: 60, minSeconds: 60, completeDist: 840 });
      expect(await order(o, '1h')).toMatchObject({ timeScale: 1, minSeconds: 3600 });
    });
  });

  describe('prize pool, rounds and leaderboards', () => {
    it('counts paid entries and splits 50 / 20 / 20 / 10 exactly; the next week is seeded with the 20 %', async () => {
      const before = (await anon().get('/api/pool').expect(200)).body;
      const a = await login();
      for (let i = 0; i < 2; i++) { // two finished 1h rides: 4h and 8h are not on sale
        const r = await order(a, '1h');
        await a.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: pay(a, r) }).expect(200);
        await a.agent.post(`/api/rides/${r.id}/start`).expect(200);
        sec(2);
        await a.agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'failed', s: 0, reason: 'x' }).expect(200); // a failed ride still counts as an entry
      }
      const pool = (await anon().get('/api/pool').expect(200)).body;
      expect(pool.split.entries - before.split.entries).toBe(100_000_000);
      expect(pool.entries - before.entries).toBe(2);
      const s = pool.split;
      expect(s.grand - s.carry + s.top20 + s.nextSeed + s.fees).toBe(s.entries);
      expect(s.top20).toBe(Math.floor(s.entries * 0.2));
      expect(pool.usd.entries).toBeCloseTo((s.entries / 1e9) * 100, 1);
      expect(pool.settled).toBe(false);

      sec(8 * 86_400); // next week
      const next = (await anon().get('/api/pool').expect(200)).body;
      expect(next.round.id).toBe(pool.round.id + 1);
      expect(next.split).toMatchObject({ entries: 0, carry: s.nextSeed, grand: s.nextSeed });
    });

    it('ranks completed (verified) paid rides by distance this round; free rides have their own board', async () => {
      const d = await login(DEMO_WALLET);
      const r = await order(d, '1h'); // demo: 60 s / 840 m
      await d.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: pay(d, r) }).expect(200);
      await d.agent.post(`/api/rides/${r.id}/start`).expect(200);
      for (let i = 1; i <= 7; i++) {
        sec(10);
        await d.agent.post(`/api/rides/${r.id}/heartbeat`).send({ s: i * 130, t: i * 10, hull: 100 }).expect(200);
      }
      await upload(d.agent, r.id, recording(r.id, { seconds: 70, distance: 910, road: r.seed })); // what the game records (with the damage of the server's holes) – the paid boards rank verified shifts only
      expect((await d.agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'shift', s: 910, t: 70, hull: 100 }).expect(200)).body.status).toBe('completed');
      const board = (await anon().get('/api/leaderboard').expect(200)).body;
      expect(board.board).toBe('round');
      expect(board.rows[0]).toMatchObject({ rank: 1, wallet: d.address, distance: 910, rides: 1 });
      for (const level of [1, 2, 3]) expect((await anon().get(`/api/leaderboard?board=free&level=${level}`).expect(200)).body.rows.every((x: { wallet: string }) => x.wallet !== d.address)).toBe(true);
    });
  });
}
