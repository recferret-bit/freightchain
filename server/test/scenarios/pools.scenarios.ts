import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../../src/application/ports/economy/promo.repository.port.js';
import { RideTicketRepositoryPort } from '../../src/application/ports/players/ride-ticket.repository.port.js';
import { TransactionPort } from '../../src/application/ports/shared/transaction.port.js';
import type { PoolProps } from '../../src/domain/economy/pool.types.js';
import { bindClient, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { aPool } from '../support/pools.js';
import { aPromo, ticketEffect } from '../support/promos.js';
import type { PromoCreateInput } from '../../src/domain/economy/promo.types.js';

/* Escrowed pools as the API shows them, promo codes that add tickets, and paid rides that spend a ticket. Pools are seeded straight into the mirror
   (in production the chain watcher writes them); tickets come from promo codes here – the on-chain purchase path is the order workstream's. */
export const POOLS_ENV = { FREE_RIDE_SECONDS: '10' };

export function poolScenarios(h: () => Harness): void {
  const { anon, login, sec, now } = bindClient(h);
  beforeEach(() => h().reset());

  const pools = () => h().app.get(PoolRepositoryPort, { strict: false });
  const tickets = () => h().app.get(RideTicketRepositoryPort, { strict: false });
  const promos = () => h().app.get(PromoRepositoryPort, { strict: false });
  const seedPool = (over: Partial<PoolProps>) => pools().upsert(aPool(over, new Date(now())));
  const seedPromo = (code: string, over: Partial<PromoCreateInput> = {}) => promos().insert(aPromo(new Date(now()), { code, maxRedemptions: null, ...over }));
  const redeem = (w: Rider, code: string) => w.agent.post('/api/promo/redeem').send({ code });
  const ride = (w: Rider, tier: string) => w.agent.post('/api/rides').send({ tier });

  describe('pools (public)', () => {
    it('lists open and active pools with progress, rules and treasuries; one pool by id in any status; 404 / 400 otherwise', async () => {
      await seedPool({ id: 1, status: 'open', minTickets: 10, ticketsSold: 7, buyers: 5, vaultLamports: 350_000_000 });
      await seedPool({ id: 2, status: 'refunding' });
      const { body } = await anon().get('/api/pools').expect(200);
      expect(body.pools).toHaveLength(1);
      expect(body.pools[0]).toMatchObject({ id: 1, status: 'open', sold: 7, buyers: 5, minTickets: 10, toGo: 3, progressPct: 70, vaultLamports: 350_000_000, split: { prizeBps: 7000, seedBps: 2000, feeBps: 1000 } });
      expect((await anon().get('/api/pools/2').expect(200)).body).toMatchObject({ id: 2, status: 'refunding' });
      await anon().get('/api/pools/3').expect(404);
      await anon().get('/api/pools/abc').expect(400);
    });

    it('the tiers list prices a pooled tier by its pool, and the round pot lists the live pools', async () => {
      await seedPool({ id: 1, tier: '4h', status: 'active', priceLamports: 120_000_000 });
      const tiers = (await anon().get('/api/tiers').expect(200)).body;
      expect(tiers.tiers.find((t: { id: string }) => t.id === '4h')).toMatchObject({ lamports: 120_000_000, available: true, pool: { id: 1 } });
      expect(tiers.tiers.find((t: { id: string }) => t.id === '1h').pool).toBeNull();
      expect((await anon().get('/api/pool').expect(200)).body.pools.map((p: { id: number }) => p.id)).toEqual([1]);
    });
  });

  describe('promo codes', () => {
    it('redeem adds tickets into the live pool of the tier; /api/me and /api/profile show them; a second redeem is 409', async () => {
      await seedPool({ id: 1, status: 'open' });
      await seedPromo('WELCOME');
      const w = await login();
      expect((await redeem(w, ' welcome ').expect(200)).body).toEqual({ kind: 'tickets', code: 'WELCOME', label: '2 × 1h ride tickets', poolId: 1, tier: '1h', added: 2, balance: 2, cap: 5 });
      expect((await w.agent.get('/api/me').expect(200)).body.tickets).toEqual([{ poolId: 1, tier: '1h', label: '1 HOUR · test', status: 'open', balance: 2, bought: 0, cap: 5, refundable: false }]);
      const profile = (await w.agent.get('/api/profile').expect(200)).body;
      expect(profile.grants).toEqual([{ poolId: 1, delta: 2, source: 'promo', ref: 'WELCOME', at: now() }]);
      expect((await redeem(w, 'WELCOME').expect(409)).body).toMatchObject({ code: 'promo_unavailable' });
    });

    it('unknown code 404, signed-out 401, bad body 400, nothing open 409', async () => {
      const w = await login();
      await redeem(w, 'NOPE').expect(404);
      await anon().post('/api/promo/redeem').send({ code: 'NOPE' }).expect(401);
      await w.agent.post('/api/promo/redeem').send({}).expect(400);
      await seedPromo('LATER', { effect: ticketEffect({ tier: '8h' }) });
      expect((await redeem(w, 'LATER').expect(409)).body).toMatchObject({ code: 'no_open_pool' });
    });

    it('the last redemption of a limited code goes to one wallet only, and a wallet at the cap does not burn one', async () => {
      await seedPool({ id: 1, status: 'active', maxPerWallet: 2 });
      await seedPromo('ONE', { maxRedemptions: 1 });
      await seedPromo('MORE', { effect: ticketEffect({ credits: 2 }) });
      const a = await login(), b = await login();
      await redeem(a, 'ONE').expect(200);
      await redeem(b, 'ONE').expect(409);
      await redeem(a, 'MORE').expect(409); // a holds 2 = the cap
      expect((await promos().findByCode('MORE'))?.snapshot().redeemed).toBe(0);
    });
  });

  describe('paid rides spend tickets', () => {
    it('one ticket = one ready ride in the pool; a re-ask hands the same ride back; at zero → 409 no_tickets', async () => {
      await seedPool({ id: 1, status: 'active' });
      await seedPromo('ONE', { effect: ticketEffect({ credits: 1 }) });
      const w = await login();
      await redeem(w, 'ONE').expect(200);
      const r = (await ride(w, '1h').expect(200)).body;
      expect(r).toMatchObject({ tier: '1h', status: 'created', poolId: 1, lamports: 0 });
      expect((await ride(w, '1h').expect(200)).body.id).toBe(r.id);
      expect((await w.agent.get('/api/me')).body.tickets[0].balance).toBe(0);
      await w.agent.post(`/api/rides/${r.id}/start`).expect(200);
      sec(2); await w.agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'failed', s: 0, t: 1 }).expect(200);
      expect((await ride(w, '1h').expect(409)).body).toMatchObject({ code: 'no_tickets', detail: 'no 1h tickets left' });
    });

    it('tickets in a pool still short of its minimum cannot be ridden yet (409 pool_not_live); once it is active they can', async () => {
      await seedPool({ id: 1, status: 'open', minTickets: 3, ticketsSold: 1 });
      await seedPromo('WAIT', { effect: ticketEffect({ credits: 1 }) });
      const w = await login();
      await redeem(w, 'WAIT').expect(200);
      expect((await ride(w, '1h').expect(409)).body).toMatchObject({ code: 'pool_not_live', detail: 'pool not live yet – 2 more tickets needed' });
      await seedPool({ id: 1, status: 'active', minTickets: 3, ticketsSold: 3 });
      expect((await ride(w, '1h').expect(200)).body.poolId).toBe(1);
    });

    it('a failed pool voids unused tickets: the wallet is left with none to ride', async () => {
      await seedPool({ id: 1, status: 'active' });
      await seedPromo('TWO');
      const w = await login();
      await redeem(w, 'TWO').expect(200);
      await seedPool({ id: 1, status: 'refunding' });
      const voided = await voidPool(h, 1, now());
      expect(voided).toBe(2);
      expect((await w.agent.get('/api/me')).body.tickets).toEqual([]); // a refunding pool with nothing held is not listed
      expect((await tickets().find(w.address, 1))?.balance).toBe(0);
    });
  });
}

/** What the chain watcher will do on PoolFailed: void every unused ticket of the pool in one transaction. */
async function voidPool(h: () => Harness, poolId: number, nowMs: number): Promise<number> {
  const transactions = h().app.get(TransactionPort, { strict: false });
  const repo = h().app.get(RideTicketRepositoryPort, { strict: false });
  return transactions.run((tx) => repo.voidAllOfPool(poolId, new Date(nowMs), tx));
}
