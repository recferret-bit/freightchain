import { CommandBus } from '@nestjs/cqrs';
import { PromoRepositoryPort } from '../../src/application/ports/economy/promo.repository.port.js';
import { RegisterPoolFromChainCommand } from '../../src/application/use-cases/pools/register-pool-from-chain/register-pool-from-chain.command.js';
import type { PoolChainState } from '../../src/domain/economy/chain-events.js';
import { RoadLayout } from '../../src/domain/road/road-layout.js';
import { bindClient, type Rider } from '../support/client.js';
import { TREASURY, newSignature } from '../support/fake-chain.js';
import type { Harness } from '../support/harness.js';
import { chainPool } from '../support/pools.js';
import { aPromo, ticketEffect } from '../support/promos.js';
import { setTierOnSaleForTest } from '../../src/domain/rides/ride-tier.js';

/* ONE ROAD PER COMPETITION, end to end over HTTP: every paid ride of one competition – a pool, or (pay-per-ride, opted on in this file) a paid tier on one UTC
   day – is driven on the same seed, so it gets the same route, start hour, trip, road layout and holes, from the first minute of the window to the last;
   the next pool / the next day is another road. The road is read the way the game and every replay read it: the ride's world from the API, the holes
   from the public obstacle plan (GET /api/watch/:id/road), the layout rebuilt from the served seed + trip with the server's own port of the generator. */
export const SHARED_ROAD_ENV = { CHALLENGE_INTERVAL_SECONDS: '0' };

const KM = 10_000; // the stretch compared: the first 10 km (one plan request)
const DAY = 86_400_000;

export function sharedRoadScenarios(h: () => Harness): void {
  const { anon, login, sec, now } = bindClient(h);
  beforeEach(() => { setTierOnSaleForTest('1h', true); return h().reset(); }); // the pay-per-ride half; production leaves 1h off until a pool exists
  afterEach(() => setTierOnSaleForTest('1h', false));

  /** what a rider of a started ride drives: its world, its holes and its layout – everything that makes the road */
  const roadOf = async (w: Rider, id: string) => {
    const ride = (await w.agent.get(`/api/rides/${id}`).expect(200)).body;
    if (ride.tier === 'free') {
      await anon().get(`/api/watch/${id}`).expect(403);
    } else {
      const watched = (await anon().get(`/api/watch/${id}`).expect(200)).body.ride;
      expect(watched).toMatchObject({ seed: ride.seed, route: ride.route, trip: ride.trip }); // spectators rebuild the same road the driver got
    }
    const plan = (await anon().get(`/api/watch/${id}/road?from=0&to=${KM}`).expect(200)).body;
    expect(plan.seed).toBe(ride.seed);
    return { seed: ride.seed, route: ride.route, startHour: ride.startHour, trip: ride.trip, holes: plan.holes, layout: new RoadLayout(ride.seed, ride.trip).describe(KM) };
  };
  /** the road WITHOUT the seed: two different seeds must still give two different roads */
  const content = (r: Awaited<ReturnType<typeof roadOf>>) => ({ holes: r.holes, layout: r.layout });

  describe('pay-per-ride (opted on in this file): one road per paid tier per UTC day', () => {
    /** order the 1-hour shift, pay it on the fake chain, start it */
    const paidRide = async (w: Rider): Promise<string> => {
      const r = (await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
      const sig = newSignature();
      h().chain.txs.set(sig, { outcome: 'success', feePayer: w.address, feePayerSigned: true, transfers: [{ source: w.address, destination: TREASURY, lamports: r.lamports }], memos: [r.id] });
      expect((await w.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(200)).body).toMatchObject({ status: 'paid' });
      await w.agent.post(`/api/rides/${r.id}/start`).expect(200);
      return r.id;
    };
    const toNextMidnight = () => { const d = new Date(now()); sec((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now()) / 1000); };

    it('the first second, midday and the last millisecond of a day: one seed, the same route, start hour, trip, layout and holes for every rider', async () => {
      toNextMidnight(); // 00:00:00.000 UTC
      const first = await login(), noon = await login(), last = await login();
      const a = await roadOf(first, await paidRide(first));
      sec(12 * 3600);
      const b = await roadOf(noon, await paidRide(noon));
      sec(12 * 3600 - 0.001); // 23:59:59.999 – still the same day
      const c = await roadOf(last, await paidRide(last));
      expect(a.holes.length).toBeGreaterThan(0); // there IS road content to compare
      expect(a.layout.junctions.length).toBeGreaterThan(1);
      expect(b).toEqual(a);
      expect(c).toEqual(a);
    });

    it('the next day is another road: a new seed, another layout and other holes – shared again by everyone that day', async () => {
      toNextMidnight();
      const d1 = await login();
      const today = await roadOf(d1, await paidRide(d1));
      sec(DAY / 1000); // 00:00 the next day
      const [x, y] = [await login(), await login()];
      const tomorrow = await roadOf(x, await paidRide(x));
      expect(tomorrow.seed).not.toBe(today.seed);
      expect(content(tomorrow)).not.toEqual(content(today));
      sec(3600);
      expect(await roadOf(y, await paidRide(y))).toEqual(tomorrow);
    });

    it('the same rider ordering again the same day gets the same road; free rides on that day each get their own', async () => {
      const w = await login(), f1 = await login(), f2 = await login();
      const firstId = await paidRide(w);
      const one = await roadOf(w, firstId);
      sec(2); await w.agent.post(`/api/rides/${firstId}/end`).send({ outcome: 'failed', s: 0, t: 1 }).expect(200);
      const again = await roadOf(w, await paidRide(w));
      expect(again).toEqual(one);
      const free = async (r: Rider) => { const id = (await r.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body.id; await r.agent.post(`/api/rides/${id}/start`).expect(200); return roadOf(r, id); };
      const [g1, g2] = [await free(f1), await free(f2)];
      expect(new Set([one.seed, g1.seed, g2.seed]).size).toBe(3);
    });
  });

  describe('escrowed pools: one road per pool, the next pool another', () => {
    const bus = () => h().app.get(CommandBus, { strict: false });
    const promos = () => h().app.get(PromoRepositoryPort, { strict: false });
    /** a pool account on the fake chain, live (active), brought into the mirror the way `pool:register` / the watcher do – the server draws its seed there */
    const livePool = async (poolId: number, over: Partial<PoolChainState> = {}): Promise<PoolChainState> => {
      const state = chainPool(new Date(now()), { poolId, address: `PoolPda${String(poolId).padStart(37, '1')}`, status: 'active', ticketsSold: 10, minTickets: 10, ...over });
      h().poolChain.pools.set(poolId, state);
      await bus().execute(new RegisterPoolFromChainCommand(poolId));
      await promos().insert(aPromo(new Date(now()), { code: `POOL${poolId}`, effect: ticketEffect({ poolId, credits: 1 }), maxRedemptions: null }));
      return state;
    };
    /** a ticket of that pool (a promo code stands in for the on-chain purchase), ridden and started */
    const ticketRide = async (w: Rider, poolId: number): Promise<string> => {
      await w.agent.post('/api/promo/redeem').send({ code: `POOL${poolId}` }).expect(200);
      const r = (await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
      expect(r.poolId).toBe(poolId);
      await w.agent.post(`/api/rides/${r.id}/start`).expect(200);
      return r.id;
    };

    it('every rider of a pool, from the window opening to the last second of the sale (and across a re-sync), drives the same road; the seed is never served with the pool', async () => {
      const state = await livePool(1);
      const [early, late] = [await login(), await login()];
      await early.agent.post('/api/promo/redeem').send({ code: 'POOL1' }).expect(200);
      await late.agent.post('/api/promo/redeem').send({ code: 'POOL1' }).expect(200);
      const ride = async (w: Rider) => { const r = (await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body; await w.agent.post(`/api/rides/${r.id}/start`).expect(200); return roadOf(w, r.id); };
      const a = await ride(early);
      h().poolChain.pools.set(1, { ...state, ticketsSold: 14, buyers: 12 }); // the chain moved on; the mirror re-syncs
      await bus().execute(new RegisterPoolFromChainCommand(1));
      sec((state.prepDeadline.getTime() - now()) / 1000 - 1); // the last second a ride may start (no new rides after the sale end)
      const b = await ride(await login({ address: late.address, kp: late.kp })); // the same wallet signs in again (its session cookie expired over the days), its ticket waited
      expect(a.holes.length).toBeGreaterThan(0);
      expect(b).toEqual(a);
      const pools = JSON.stringify((await anon().get('/api/pools').expect(200)).body) + JSON.stringify((await anon().get('/api/pools/1').expect(200)).body);
      expect(pools).not.toContain('rideSeed');
      expect(pools).not.toContain(String(a.seed));
    });

    it('the next pool of the same tier is another road: its own seed, layout and holes, shared by all of ITS riders', async () => {
      await livePool(1);
      const p1 = await login();
      const first = await roadOf(p1, await ticketRide(p1, 1));
      await livePool(2, { playDeadline: new Date(now() + 13 * DAY) }); // ends first, so a holder of both rides it first – here only pool 2 tickets are held
      const [x, y] = [await login(), await login()];
      const next = await roadOf(x, await ticketRide(x, 2));
      expect(next.seed).not.toBe(first.seed);
      expect(content(next)).not.toEqual(content(first));
      expect(await roadOf(y, await ticketRide(y, 2))).toEqual(next);
    });
  });
}
