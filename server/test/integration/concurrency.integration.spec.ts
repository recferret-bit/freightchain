import { CommandBus } from '@nestjs/cqrs';
import { ReconcileStatsCommand } from '../../src/application/use-cases/stats/reconcile-stats/reconcile-stats.command.js';
import { SweepStaleRidesCommand } from '../../src/application/use-cases/rides/sweep-stale-rides/sweep-stale-rides.command.js';
import { GrantDailyFreeRidesCommand } from '../../src/application/use-cases/players/grant-daily-free-rides/grant-daily-free-rides.command.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { bindClient, newWallet, sign, type Rider } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';
import { recording } from '../support/recording.js';
import { VerdictService } from '../../src/application/services/verdict.service.js';
import { TREASURY } from '../support/fake-chain.js';
import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import { PoolPayoutRepositoryPort } from '../../src/application/ports/economy/pool-payout.repository.port.js';
import { PromoRepositoryPort } from '../../src/application/ports/economy/promo.repository.port.js';
import { TransactionPort } from '../../src/application/ports/shared/transaction.port.js';
import { RideTicketRepositoryPort } from '../../src/application/ports/players/ride-ticket.repository.port.js';
import { aPromo, ticketEffect } from '../support/promos.js';
import { aPool } from '../support/pools.js';
import { TicketSettlementService, type PurchaseEvent } from '../../src/application/services/ticket-settlement.service.js';
import { FinalityService } from '../../src/application/services/finality.service.js';
import { ChainEventRepositoryPort } from '../../src/application/ports/economy/chain-event.repository.port.js';
import { PollProgramCommand, type PollProgramResultDto } from '../../src/application/use-cases/chain/poll-program/poll-program.command.js';
import { ReceiveChainWebhookCommand, type ChainWebhookResultDto } from '../../src/application/use-cases/chain/receive-chain-webhook/receive-chain-webhook.command.js';

/* What in-memory fakes can never tell you: parallel requests against a real database. Every critical section the old synchronous SQLite server got "for free"
   is exercised here with Promise.all and EXACT counts – one ride, one credit, one successful verify, one round, one payment. */
const PARALLEL = 8;

describe('concurrency (PostgreSQL)', () => {
  let harness: Harness;
  let prisma: PrismaService;
  const { anon, login, sec, server } = bindClient(() => harness);

  beforeAll(async () => {
    harness = await createHarness('postgres', { FREE_RIDE_SECONDS: '10' });
    prisma = harness.app.get(PrismaService, { strict: false });
  });
  afterAll(() => harness.close());
  beforeEach(() => harness.reset());

  const parallel = <T>(n: number, fn: (i: number) => Promise<T>): Promise<T[]> => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
  const rideCount = (wallet: string) => prisma.ride.count({ where: { wallet } });
  const freeRides = async (a: Rider) => (await a.agent.get('/api/me').expect(200)).body.freeRides as number;

  it('N parallel "free ride" requests create ONE ride and spend ONE credit', async () => {
    const a = await login();
    const results = await parallel(PARALLEL, () => a.agent.post('/api/rides').send({ tier: 'free' }));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await rideCount(a.address)).toBe(1);
    expect(await freeRides(a)).toBe(9); // 10 at signup, one credit
  });

  it('N parallel paid orders for the same tier are ONE order', async () => {
    const a = await login();
    const results = await parallel(PARALLEL, () => a.agent.post('/api/rides').send({ tier: '1h' }));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await rideCount(a.address)).toBe(1);
  });

  it('N wallets placing the FIRST paid order of the day at once all get ONE road – the day\'s seed is stored once', async () => {
    const riders = await parallel(PARALLEL, () => login());
    const results = await parallel(PARALLEL, (i) => (riders[i] as Rider).agent.post('/api/rides').send({ tier: '1h' }));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.seed)).size).toBe(1);
    expect(await prisma.dailySeed.count()).toBe(1);
  });

  it('parallel "buy while holding an unstarted free ride" refunds the credit ONCE', async () => {
    const a = await login();
    await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200);
    expect(await freeRides(a)).toBe(9); // 10 at signup, one credit
    const results = await parallel(PARALLEL, () => a.agent.post('/api/rides').send({ tier: '1h' }));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await freeRides(a)).toBe(10); // refunded exactly once (still above the daily cap)
    expect(await prisma.ride.count({ where: { wallet: a.address, status: 'cancelled' } })).toBe(1);
    expect(await prisma.ride.count({ where: { wallet: a.address, status: 'awaiting_payment' } })).toBe(1);
  });

  describe('promo codes beyond tickets', () => {
    const promos = () => harness.app.get(PromoRepositoryPort, { strict: false });

    it('a free-ride code racing the midnight grant: the rides are added once and the grant never takes them back', async () => {
      await promos().insert(aPromo(harness.clock.now(), { code: 'RIDES', effect: { kind: 'free_rides', count: 3 }, maxRedemptions: null }));
      const a = await login();
      sec(86_400); // tomorrow: the daily grant is due for everyone
      const bus = harness.app.get(CommandBus, { strict: false });
      const [redeems] = await Promise.all([
        parallel(PARALLEL, () => a.agent.post('/api/promo/redeem').send({ code: 'RIDES' })),
        bus.execute(new GrantDailyFreeRidesCommand()),
        a.agent.get('/api/me'),
      ]);
      expect(redeems.filter((r) => r.status === 200)).toHaveLength(1);
      expect(redeems.filter((r) => r.status === 409)).toHaveLength(PARALLEL - 1);
      expect(await freeRides(a)).toBe(13); // 10, above the daily cap so the grant adds nothing, + 3
      expect(await prisma.promoRedemption.count({ where: { wallet: a.address } })).toBe(1);
    });

    it('the last redemption of a scheduled code at the instant it starts goes to ONE wallet; one second earlier to nobody', async () => {
      const now = harness.clock.now();
      await promos().insert(aPromo(now, { code: 'OPENING', effect: { kind: 'free_rides', count: 1 }, maxRedemptions: 1, startsAt: new Date(now.getTime() + 60_000) }));
      const riders = await parallel(PARALLEL, () => login());
      const redeem = () => Promise.all(riders.map((r) => r.agent.post('/api/promo/redeem').send({ code: 'OPENING' })));
      sec(59);
      expect((await redeem()).every((r) => r.status === 409)).toBe(true);
      expect(await prisma.promoCode.findUnique({ where: { code: 'OPENING' } })).toMatchObject({ redeemed: 0 });
      sec(1);
      const results = await redeem();
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.promoCode.findUnique({ where: { code: 'OPENING' } })).toMatchObject({ redeemed: 1 });
    });

    it('a cosmetic code redeemed N times at once by one wallet unlocks it once and uses ONE redemption', async () => {
      await promos().insert(aPromo(harness.clock.now(), { code: 'WHEEL', effect: { kind: 'cosmetic', slot: 'wheel', item: 'gold' }, maxRedemptions: null, perWallet: 3 }));
      const a = await login();
      const results = await parallel(PARALLEL, () => a.agent.post('/api/promo/redeem').send({ code: 'WHEEL' }));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.cosmeticUnlock.count({ where: { wallet: a.address } })).toBe(1);
      expect(await prisma.promoCode.findUnique({ where: { code: 'WHEEL' } })).toMatchObject({ redeemed: 1 });
    });
  });

  describe('the payout job', () => {
    it('N passes racing to claim the same prize: exactly ONE may broadcast, and the row ends with that one signature', async () => {
      const now = harness.clock.now();
      await harness.app.get(PoolRepositoryPort, { strict: false }).upsert(aPool({ id: 1, status: 'active' }, now));
      const ledger = harness.app.get(PoolPayoutRepositoryPort, { strict: false });
      await ledger.plan([{ poolId: 1, rank: 1, wallet: 'alice', lamports: 1_000, status: 'planned' }], now);
      const won = await parallel(PARALLEL, (i) => ledger.claimSent(1, 1, `Sig${i}`, 100, now));
      expect(won.filter(Boolean)).toHaveLength(1);
      const row = (await ledger.listByPool(1))[0]!;
      expect(row).toMatchObject({ status: 'sent', attempts: 1, signature: `Sig${won.indexOf(true)}` });
    });

    it('an admin hold racing chain syncs of the same pool: the hold always survives', async () => {
      const now = harness.clock.now();
      const pools = harness.app.get(PoolRepositoryPort, { strict: false });
      await pools.upsert(aPool({ id: 2, status: 'active' }, now));
      await Promise.all([
        pools.saveHold(2, { by: 'Admin', at: now, note: 'wait' }),
        ...Array.from({ length: PARALLEL }, (_, i) => pools.upsert(aPool({ id: 2, status: 'active', ticketsSold: i, hold: null }, now))),
      ]);
      expect((await pools.findById(2))?.hold).toMatchObject({ by: 'Admin', note: 'wait' });
    });
  });

  describe('escrowed pool tickets', () => {
    const seed = async (pool: Parameters<typeof aPool>[0], promo: { code: string; credits: number; maxRedemptions: number | null }) => {
      const now = harness.clock.now();
      await harness.app.get(PoolRepositoryPort, { strict: false }).upsert(aPool(pool, now));
      await harness.app.get(PromoRepositoryPort, { strict: false }).insert(aPromo(now, { code: promo.code, effect: ticketEffect({ credits: promo.credits }), maxRedemptions: promo.maxRedemptions }));
    };

    it('N parallel paid-ride requests with ONE ticket: one ride, the ticket spent once, one spend line', async () => {
      await seed({ id: 1, status: 'active' }, { code: 'ONE', credits: 1, maxRedemptions: null });
      const a = await login();
      await a.agent.post('/api/promo/redeem').send({ code: 'ONE' }).expect(200);
      const results = await parallel(PARALLEL, () => a.agent.post('/api/rides').send({ tier: '1h' }));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await rideCount(a.address)).toBe(1);
      expect(await prisma.rideTicket.findUnique({ where: { wallet_poolId: { wallet: a.address, poolId: 1 } } })).toMatchObject({ balance: 0 });
      expect(await prisma.ticketGrant.count({ where: { wallet: a.address, source: 'spend' } })).toBe(1);
    });

    it('the last redemption of a promo code goes to ONE of N wallets redeeming at once; one wallet redeeming N times gets it once', async () => {
      await seed({ id: 1, status: 'open' }, { code: 'LAST', credits: 2, maxRedemptions: 1 });
      const riders = await parallel(PARALLEL, () => login());
      const results = await Promise.all(riders.map((r) => r.agent.post('/api/promo/redeem').send({ code: 'LAST' })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(PARALLEL - 1);
      expect(await prisma.promoCode.findUnique({ where: { code: 'LAST' } })).toMatchObject({ redeemed: 1 });
      await harness.app.get(PromoRepositoryPort, { strict: false }).insert(aPromo(harness.clock.now(), { code: 'MINE', maxRedemptions: null }));
      const a = await login();
      const mine = await parallel(PARALLEL, () => a.agent.post('/api/promo/redeem').send({ code: 'MINE' }));
      expect(mine.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.rideTicket.findUnique({ where: { wallet_poolId: { wallet: a.address, poolId: 1 } } })).toMatchObject({ balance: 2 });
    });

    const purchase = (buyer: string, over: Partial<PurchaseEvent> = {}): PurchaseEvent =>
      ({ kind: 'TicketBought', signature: `sig-${buyer.slice(0, 6)}`, index: 0, slot: 1, poolId: 1, buyer, qty: 1, lamports: 50_000_000, orderId: '', ticketsSold: 1, activated: false, ...over });

    it('the same purchase event settled N times at once (confirm, webhook, poll): credited ONCE, every caller sees it paid', async () => {
      await seed({ id: 1, status: 'open' }, { code: 'XYZ', credits: 1, maxRedemptions: null });
      const a = await login();
      const svc = harness.app.get(TicketSettlementService, { strict: false });
      const results = await parallel(PARALLEL, () => svc.settlePurchase(purchase(a.address, { qty: 2, lamports: 100_000_000, ticketsSold: 2 })));
      expect(results.filter((r) => r.outcome === 'applied')).toHaveLength(1);
      expect(results.filter((r) => r.outcome === 'duplicate')).toHaveLength(PARALLEL - 1);
      expect(await prisma.rideTicket.findUnique({ where: { wallet_poolId: { wallet: a.address, poolId: 1 } } })).toMatchObject({ balance: 2, bought: 2 });
      expect(await prisma.ticketOrder.count({ where: { wallet: a.address, status: 'paid' } })).toBe(1);
      expect(await prisma.pool.findUnique({ where: { id: 1 } })).toMatchObject({ ticketsSold: 2, buyers: 1 });
    });

    it('purchases racing the pool failing: no deadlock, and every paid ticket ends up voided but still refundable', async () => {
      await seed({ id: 1, status: 'open', minTickets: 50 }, { code: 'XYZ', credits: 1, maxRedemptions: null });
      const riders = await parallel(6, () => login());
      const svc = harness.app.get(TicketSettlementService, { strict: false });
      await Promise.all([
        ...riders.map((r, i) => svc.settlePurchase(purchase(r.address, { ticketsSold: i + 1 }))),
        svc.applyPoolEvent({ kind: 'PoolFailed', signature: 'fail', index: 0, slot: 9, poolId: 1, ticketsSold: 6 }),
      ]);
      expect(await prisma.pool.findUnique({ where: { id: 1 } })).toMatchObject({ status: 'refunding' });
      expect(await prisma.rideTicket.aggregate({ _sum: { balance: true, bought: true } })).toMatchObject({ _sum: { balance: 0, bought: 6 } });
    });

    it('the webhook and the poll settle the same transaction at once: credited ONCE, one order, the pool activated once, one log row per event', async () => {
      await seed({ id: 1, status: 'open', minTickets: 2 }, { code: 'XYZ', credits: 1, maxRedemptions: null });
      const a = await login();
      const sig = harness.poolChain.addTransaction([
        { kind: 'TicketBought', poolId: 1, buyer: a.address, qty: 2, lamports: 100_000_000, orderId: '', ticketsSold: 2, activated: true },
        { kind: 'PoolActivated', poolId: 1, ticketsSold: 2 },
      ]);
      const bus = harness.app.get(CommandBus, { strict: false });
      const results = await Promise.all([
        ...Array.from({ length: 4 }, () => bus.execute<ReceiveChainWebhookCommand, ChainWebhookResultDto>(new ReceiveChainWebhookCommand([sig]))),
        ...Array.from({ length: 4 }, () => bus.execute<PollProgramCommand, PollProgramResultDto>(new PollProgramCommand())),
      ]);
      expect(results.slice(0, 4).every((r) => (r as ChainWebhookResultDto).settled === 1)).toBe(true);
      expect(results.slice(4).every((r) => (r as PollProgramResultDto).cursor === sig)).toBe(true);
      expect(await prisma.rideTicket.findUnique({ where: { wallet_poolId: { wallet: a.address, poolId: 1 } } })).toMatchObject({ balance: 2, bought: 2 });
      expect(await prisma.ticketOrder.count({ where: { wallet: a.address } })).toBe(1);
      expect(await prisma.ticketGrant.count({ where: { wallet: a.address, source: 'payment' } })).toBe(1);
      expect(await prisma.pool.findUnique({ where: { id: 1 } })).toMatchObject({ status: 'active', ticketsSold: 2, buyers: 1 });
      expect(await prisma.chainEvent.count({ where: { signature: sig } })).toBe(2);
      expect(await prisma.chainCursor.findUnique({ where: { key: 'program' } })).toMatchObject({ signature: sig });
    });

    it('a dropped purchase (finality pass, N at once) racing a ride on its tickets: each ticket voided or ridden, never both; dropped once', async () => {
      await seed({ id: 1, status: 'active' }, { code: 'XYZ', credits: 1, maxRedemptions: null });
      const a = await login();
      const sig = harness.poolChain.addEvent('TicketBought', { poolId: 1, buyer: a.address, qty: 2, lamports: 100_000_000, orderId: '', ticketsSold: 2, activated: false });
      const bus = harness.app.get(CommandBus, { strict: false });
      await bus.execute(new ReceiveChainWebhookCommand([sig]));
      const rows = await harness.app.get(ChainEventRepositoryPort, { strict: false }).listUnfinalized(10);
      const finality = harness.app.get(FinalityService, { strict: false });
      const [ride, ...voided] = await Promise.all([a.agent.post('/api/rides').send({ tier: '1h' }), ...Array.from({ length: 4 }, () => finality.drop(sig, rows))]);
      const ridden = ride.status === 200 ? 1 : 0;
      expect(voided.reduce((x, y) => x + y, 0) + ridden).toBe(2);
      expect(await prisma.rideTicket.findUnique({ where: { wallet_poolId: { wallet: a.address, poolId: 1 } } })).toMatchObject({ balance: 0, bought: 0 });
      expect(await prisma.ticketGrant.count({ where: { wallet: a.address, source: 'void' } })).toBe(1);
      expect(await prisma.ticketOrder.findFirst({ where: { wallet: a.address } })).toMatchObject({ status: 'expired', signature: null }); // adopted → closed
      expect(await prisma.chainEvent.findFirst({ where: { signature: sig } })).toMatchObject({ outcome: 'dropped' });
    });

    it('a pool voided while its tickets are being spent: no ticket is both voided and ridden', async () => {
      await seed({ id: 1, status: 'active' }, { code: 'TWO', credits: 2, maxRedemptions: null });
      const riders = await parallel(4, () => login());
      for (const r of riders) await r.agent.post('/api/promo/redeem').send({ code: 'TWO' }).expect(200);
      const transactions = harness.app.get(TransactionPort, { strict: false });
      const tickets = harness.app.get(RideTicketRepositoryPort, { strict: false });
      const pools = harness.app.get(PoolRepositoryPort, { strict: false });
      const [voided, ...rides] = await Promise.all([
        transactions.run(async (tx) => { await pools.findByIdForUpdate(1, tx); return tickets.voidAllOfPool(1, harness.clock.now(), tx); }),
        ...riders.map((r) => r.agent.post('/api/rides').send({ tier: '1h' })),
      ]);
      const ridden = rides.filter((r) => r.status === 200).length;
      expect(voided + ridden).toBe(8); // 4 wallets × 2 tickets: each one either voided or spent, never both, never lost
      expect(await prisma.rideTicket.aggregate({ _sum: { balance: true } })).toMatchObject({ _sum: { balance: 0 } });
      expect(await prisma.ticketGrant.count({ where: { source: 'spend' } })).toBe(ridden);
    });
  });

  it('the daily free ride is granted ONCE however many requests see the new day', async () => {
    const a = await login();
    await prisma.player.update({ where: { wallet: a.address }, data: { freeRides: 1 } });
    sec(86_400);
    await parallel(PARALLEL, () => a.agent.get('/api/me'));
    expect(await freeRides(a)).toBe(2); // 1 + the credit for today, once
  });

  it('the midnight job racing requests that read, spend and refund credits: ONE credit for the day, none lost, none above the cap', async () => {
    const a = await login();
    await prisma.player.update({ where: { wallet: a.address }, data: { freeRides: 5 } }); // sit on the daily cap, then spend one
    await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200);   // 4 left
    sec(86_400);
    const bus = harness.app.get(CommandBus);
    await Promise.all([parallel(PARALLEL, () => a.agent.get('/api/me')), parallel(3, () => bus.execute(new GrantDailyFreeRidesCommand()))]);
    expect(await freeRides(a)).toBe(5);                                    // 4 + one credit for the new day
    await parallel(PARALLEL, () => a.agent.post('/api/rides').send({ tier: '1h' })); // refunds the unstarted free ride, which would be #6
    expect(await freeRides(a)).toBe(5);                                    // exactly at the cap: the refund does not add a sixth
  });

  it('N parallel uploads of the same recording batch store it ONCE (and every caller gets a 200)', async () => {
    const a = await login();
    const ride = (await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await a.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    const [b0] = recording(ride.id, { seconds: 10 });
    const results = await parallel(PARALLEL, () => a.agent.post(`/api/rides/${ride.id}/batches`).send(b0));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.stored === true)).toHaveLength(1);
    expect(await prisma.rideBatch.count({ where: { rideId: ride.id } })).toBe(1);
  });

  it('/end racing the late final batch and parallel re-sends: the verdict that stays has seen every batch', async () => {
    const a = await login();
    const ride = (await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await a.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    const batches = recording(ride.id, { seconds: 40, distance: 560, road: ride.seed, trip: ride.trip });
    for (const b of batches.slice(0, -1)) await a.agent.post(`/api/rides/${ride.id}/batches`).send(b).expect(200);
    sec(40);
    const last = batches.at(-1);
    const results = await Promise.all([
      a.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'shift', s: 560, t: 40 }),
      ...Array.from({ length: 4 }, () => a.agent.post(`/api/rides/${ride.id}/batches`).send(last)),
    ]);
    expect(results.map((r) => r.status).every((s) => s === 200 || s === 409)).toBe(true); // a batch that beat /end is 200; after it, within the grace minute, 200 too
    expect(await prisma.rideBatch.count({ where: { rideId: ride.id } })).toBe(batches.length);
    expect((await a.agent.get(`/api/rides/${ride.id}`).expect(200)).body.verdict).toMatchObject({ status: 'verified' });
  });

  it('a pool attention mark racing the re-judges of late batches: the verdict that stays has seen every batch AND keeps the mark', async () => {
    const a = await login();
    const ride = (await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await a.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    const batches = recording(ride.id, { seconds: 40, distance: 560, road: ride.seed, batchSeconds: 5 });
    for (const b of batches.slice(0, -3)) await a.agent.post(`/api/rides/${ride.id}/batches`).send(b).expect(200);
    sec(40);
    await a.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'shift', s: 560, t: 40 }).expect(200);
    const verdicts = harness.app.get(VerdictService, { strict: false });
    const mark = { code: 'pool-shared-ip', detail: 'race', severity: 'flag' as const };
    const results = await Promise.all([
      verdicts.addAttention(a.address, [{ rideId: ride.id, reasons: [mark] }]).then(() => 200),
      ...batches.slice(-3).map((b) => a.agent.post(`/api/rides/${ride.id}/batches`).send(b).then((r) => r.status)),
      verdicts.addAttention(a.address, [{ rideId: ride.id, reasons: [mark] }]).then(() => 200),
    ]);
    expect(results.every((s) => s === 200)).toBe(true);
    expect((await a.agent.get(`/api/rides/${ride.id}`).expect(200)).body.verdict).toMatchObject({ status: 'flagged', reasons: [mark] });   // the whole recording is clean; only the mark remains
  });

  it('an admin decision racing re-judges from late batches: the decision is what stays', async () => {
    const admin = newWallet();
    const h2 = await createHarness('postgres', { FREE_RIDE_SECONDS: '10', ADMIN_WALLETS: admin.address });
    try {
      const c = bindClient(() => h2);
      const a = await c.login(), boss = await c.loginAdmin(admin);
      const ride = (await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      await a.agent.post(`/api/rides/${ride.id}/start`).expect(200);
      const batches = recording(ride.id, { seconds: 10, distance: 140, batchSeconds: 2 });
      for (const b of batches.slice(0, 3)) await a.agent.post(`/api/rides/${ride.id}/batches`).send(b).expect(200);
      c.sec(10);
      await a.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'shift', s: 140, t: 10 }).expect(200);
      const text = (await boss.agent.post(`/api/admin/rides/${ride.id}/challenge`).set('x-fc-admin', '1').send({ action: 'override', decision: 'rejected', note: 'race' }).expect(200)).body.message;
      const results = await Promise.all([
        boss.agent.post(`/api/admin/rides/${ride.id}/verdict`).set('x-fc-admin', '1').send({ decision: 'rejected', note: 'race', signature: sign(admin.kp, text) }),
        ...batches.slice(3).map((b) => a.agent.post(`/api/rides/${ride.id}/batches`).send(b)),
      ]);
      expect(results.map((r) => r.status)).toEqual(results.map(() => 200));
      expect((await a.agent.get(`/api/rides/${ride.id}`).expect(200)).body.verdict).toMatchObject({ status: 'rejected', override: { by: admin.address, note: 'race' } });
      const p2 = h2.app.get(PrismaService, { strict: false });
      expect(await p2.adminAction.count({ where: { action: 'verdict.override' } })).toBe(1);
    } finally { await h2.close(); }
  });

  it('a sign-in challenge is single-use: of N parallel verifies exactly ONE wins', async () => {
    const w = newWallet();
    const { body } = await anon().post('/api/auth/nonce').send({ wallet: w.address }).expect(200);
    const signature = sign(w.kp, body.message);
    const results = await parallel(PARALLEL, () => anon().post('/api/auth/verify').send({ wallet: w.address, signature }));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(PARALLEL - 1);
  });

  it('the first requests of a new week create ONE round and close the old one once', async () => {
    await anon().get('/api/pool').expect(200);
    sec(8 * 86_400);
    const results = await parallel(PARALLEL, () => anon().get('/api/pool'));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.round.id)).size).toBe(1);
    expect(await prisma.round.count()).toBe(2);
    expect(await prisma.round.count({ where: { status: 'closed' } })).toBe(1);
  });

  it('N parallel confirms of the same payment settle it ONCE', async () => {
    const a = await login();
    const ride = (await a.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    const signature = harness.chain.addPayment({ payer: a.address, lamports: ride.lamports, memo: ride.id });
    const results = await parallel(PARALLEL, () => a.agent.post(`/api/rides/${ride.id}/confirm`).send({ signature }));
    expect(results.map((r) => [r.status, r.body.status])).toEqual(Array.from({ length: PARALLEL }, () => [200, 'paid'])); // the losers are idempotent, never "already used"
    expect(await prisma.payment.count()).toBe(1);
    const pool = (await anon().get('/api/pool').expect(200)).body;
    expect(pool.entries).toBe(1);
    expect(pool.split.entries).toBe(ride.lamports);
  });

  it('confirm and reconcile of the same payment racing each other (two tabs) BOTH answer "paid"', async () => {
    const a = await login();
    const ride = (await a.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    harness.chain.addPayment({ payer: a.address, lamports: ride.lamports, memo: ride.id });
    const signature = harness.chain.history.get(a.address)?.[0]?.signature ?? '';
    const results = await Promise.all([
      ...Array.from({ length: 4 }, () => a.agent.post(`/api/rides/${ride.id}/confirm`).send({ signature })),
      ...Array.from({ length: 4 }, () => a.agent.post(`/api/rides/${ride.id}/reconcile`)),
    ]);
    expect(results.map((r) => [r.status, r.body.status])).toEqual(Array.from({ length: 8 }, () => [200, 'paid']));
    expect(await prisma.payment.count()).toBe(1);
  });

  it('round carry invariant: every closed round handed exactly its 20 % (plus its carry when empty) to the next, with payments settling across the week turn', async () => {
    const riders = await Promise.all(Array.from({ length: 4 }, () => login()));
    const orders = await Promise.all(riders.map(async (r) => ({ r, ride: (await r.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body })));
    const sigs = orders.map(({ r, ride }) => harness.chain.addPayment({ payer: r.address, lamports: ride.lamports, memo: ride.id }));
    await orders[0]?.r.agent.post(`/api/rides/${orders[0].ride.id}/confirm`).send({ signature: sigs[0] }).expect(200);
    sec(5 * 86_400); // Wednesday noon + 5 days: the week has turned (sessions – 7 days on the same clock – are still valid) while the rest settle and the pool is read
    const results = await Promise.all([
      ...orders.slice(1).map(({ r, ride }, i) => r.agent.post(`/api/rides/${ride.id}/confirm`).send({ signature: sigs[i + 1] })),
      ...Array.from({ length: 4 }, () => anon().get('/api/pool')),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const rounds = await prisma.round.findMany({ orderBy: { startsAt: 'asc' } });
    for (let i = 0; i + 1 < rounds.length; i++) {
      const cur = rounds[i]!, next = rounds[i + 1]!;
      const agg = await prisma.payment.aggregate({ where: { roundId: cur.id }, _sum: { lamports: true }, _count: { _all: true } });
      const entries = Number(agg._sum.lamports ?? 0n);
      expect(cur.status).toBe('closed');
      expect(Number(next.carry), `round ${next.id}`).toBe(Math.floor(entries * 0.2) + (agg._count._all === 0 ? Number(cur.carry) : 0));
    }
    expect(await prisma.payment.count()).toBe(4);
  });

  it('one signature cannot pay two rides even in parallel (two wallets, same transaction)', async () => {
    const a = await login(), b = await login();
    const ra = (await a.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    const rb = (await b.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    const signature = harness.chain.addPayment({ payer: a.address, lamports: ra.lamports, memo: ra.id });
    harness.chain.txs.set(signature, { outcome: 'success', feePayer: b.address, feePayerSigned: true, transfers: [{ source: b.address, destination: TREASURY, lamports: rb.lamports }], memos: [rb.id] });
    const results = await Promise.all([
      a.agent.post(`/api/rides/${ra.id}/confirm`).send({ signature }),
      b.agent.post(`/api/rides/${rb.id}/confirm`).send({ signature }),
    ]);
    expect(await prisma.payment.count()).toBe(1); // the unique signature lets one of them in
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
  });

  describe('live streams', () => {
    const liveRide = async () => {
      const driver = await login();
      const ride = (await driver.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      await driver.agent.post(`/api/rides/${ride.id}/start`).expect(200);
      return { driver, ride };
    };

    it('N spectators paying for an effect in the same window: ONE effect stored, every other caller a 429 (no lock – the unique window does it)', async () => {
      const { ride } = await liveRide();
      const fans = await parallel(PARALLEL, () => login());
      const results = await parallel(PARALLEL, (i) => fans[i]!.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: i % 2 ? 'night' : 'sinkhole' }));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 429)).toHaveLength(PARALLEL - 1);
      expect(await prisma.rideEvent.count({ where: { rideId: ride.id } })).toBe(1);
    });

    it('one wallet spamming the same line in parallel stores it ONCE', async () => {
      const { ride } = await liveRide();
      const fan = await login();
      const results = await parallel(PARALLEL, () => fan.agent.post(`/api/watch/${ride.id}/messages`).send({ text: 'spam' }));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.rideEvent.count({ where: { rideId: ride.id, kind: 'message' } })).toBe(1);
    });

    it('N parallel confirms of one PAID donation (two tabs, retries): ONE feed event, every caller the same answer', async () => {
      await harness.close();
      harness = await createHarness('postgres', { FREE_RIDE_SECONDS: '10', LIVE_FREE_DONATIONS: 'off' });
      prisma = harness.app.get(PrismaService, { strict: false });
      const { ride } = await liveRide();
      const driverWallet = (await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } })).wallet;
      const fan = await login();
      const { order } = (await fan.agent.post(`/api/watch/${ride.id}/donation-orders`).send({ effect: 'sinkhole' }).expect(200)).body;
      const signature = harness.chain.addPayment({ payer: fan.address, destination: driverWallet, lamports: order.lamports, memo: order.memo });
      const results = await parallel(PARALLEL, () => fan.agent.post(`/api/watch/${ride.id}/donation-orders/${order.id}/confirm`).send({ signature }));
      expect(results.every((r) => r.status === 200)).toBe(true);
      const ids = new Set(results.filter((r) => r.body.status === 'paid').map((r) => r.body.event.id));
      expect(ids.size).toBe(1);
      expect(await prisma.rideEvent.count({ where: { rideId: ride.id } })).toBe(1);
      await harness.close();
      harness = await createHarness('postgres', { FREE_RIDE_SECONDS: '10' });
      prisma = harness.app.get(PrismaService, { strict: false });
    });

    it('N parallel mutes of one wallet by the driver leave ONE row (and every caller a 200)', async () => {
      const { driver, ride } = await liveRide();
      const troll = await login();
      const results = await parallel(PARALLEL, () => driver.agent.post(`/api/rides/${ride.id}/mutes`).send({ wallet: troll.address, muted: true }));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(await prisma.rideMute.count({ where: { rideId: ride.id } })).toBe(1);
    });

    it('N parallel "applied" acks of one effect (re-sends): ONE stamp, every caller gets that same stamp', async () => {
      const { driver, ride } = await liveRide();
      const fan = await login();
      const gift = (await fan.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: 'trench' }).expect(200)).body;
      const results = await parallel(PARALLEL, (i) => driver.agent.post(`/api/rides/${ride.id}/effects/${gift.id}/applied`).send({ t: 10 + i, s: 900 + i, lat: 2.4 }));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(new Set(results.map((r) => JSON.stringify(r.body.applied))).size).toBe(1);
      const row = await prisma.rideEvent.findUniqueOrThrow({ where: { id: gift.id } });
      expect(row.appliedS).toBe(results[0]!.body.applied.s);
    });
  });

  it('the stale-ride sweep racing a late heartbeat and /end: the ride ends exactly once, consistently, and nothing errors', async () => {
    for (let round = 0; round < 4; round++) {
      const a = await login();
      const ride = (await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      await a.agent.post(`/api/rides/${ride.id}/start`).expect(200);
      sec(160);   // silent past the 150 s timeout: abandoned
      const bus = harness.app.get(CommandBus);
      const results = await Promise.all([
        bus.execute(new SweepStaleRidesCommand()), bus.execute(new SweepStaleRidesCommand()),
        a.agent.post(`/api/rides/${ride.id}/heartbeat`).send({ s: 30, t: 3, hull: 100 }),
        a.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'shift', s: 30, t: 3 }),
      ]);
      const [s1, s2, hb, end] = results as [{ ended: number }, { ended: number }, { status: number }, { status: number; body: { status: string } }];
      expect(s1.ended + s2.ended).toBeLessThanOrEqual(1);   // never ended twice by the sweep
      expect(hb.status).toBeLessThan(500); expect([200, 409]).toContain(end.status);   // /end lands, or finds the ride the sweep already ended (409)
      const row = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
      expect(row.status).not.toBe('running'); expect(row.endedAt).not.toBeNull();
      if (s1.ended + s2.ended === 1) expect(row).toMatchObject({ status: 'failed', reason: 'heartbeat lost' });
      if (end.status === 409) expect(row).toMatchObject({ status: 'failed', reason: 'heartbeat lost' });   // refused only because the sweep – or the late heartbeat itself (Ride.applyReport) – had ended it
    }
  });

  it('a double START starts the ride once', async () => {
    const a = await login();
    const ride = (await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    const results = await parallel(PARALLEL, () => a.agent.post(`/api/rides/${ride.id}/start`));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(PARALLEL - 1);
  });

  it('re-choosing the ready free ride\'s LEVEL racing its START: started as the old level or re-chosen and then started – never a mix, never a second credit', async () => {
    const LEVEL_1 = { trip: 'free-1', minSeconds: 10, completeDist: 0.25 * 28 * 10 };    // FREE_RIDE_SECONDS 10 (the harness) × the level's multiple, k × MAX_SPEED × that
    const LEVEL_3 = { trip: 'free-3', minSeconds: 100, completeDist: 0.4 * 28 * 100, assist: false };
    for (let round = 0; round < 6; round++) {   // either order may win each round; every round must be one whole level
      const a = await login(), credits = await freeRides(a);
      const ride = (await a.agent.post('/api/rides').send({ tier: 'free', level: 1 }).expect(200)).body;
      const [again, start] = await Promise.all([a.agent.post('/api/rides').send({ tier: 'free', level: 3 }), a.agent.post(`/api/rides/${ride.id}/start`)]);
      expect(start.status).toBe(200);                                                      // the start always lands: the ride was ready, and re-choosing keeps it ready
      expect([200, 409]).toContain(again.status);                                          // re-chosen (it came first), or "a ride is already in progress" (the start came first)
      const row = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
      expect(row.status).toBe('running');
      expect(await rideCount(a.address)).toBe(1);
      expect(await freeRides(a)).toBe(credits - 1);                                        // one credit, whatever the order
      if (again.status === 200) { expect(again.body.id).toBe(ride.id); expect(row).toMatchObject(LEVEL_3); }
      else expect(row).toMatchObject(LEVEL_1);
      expect(start.body).toMatchObject({ trip: row.trip, minSeconds: row.minSeconds, completeDist: row.completeDist }); // the start answered with the ride as it was started – the same level as the row
    }
  });

  it('END never loses to a racing heartbeat: the ride always ends (and so never blocks the wallet)', async () => {
    for (let round = 0; round < 5; round++) {
      const a = await login();
      const ride = (await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      await a.agent.post(`/api/rides/${ride.id}/start`).expect(200);
      sec(5);
      const [beats, end] = await Promise.all([
        parallel(4, (i) => a.agent.post(`/api/rides/${ride.id}/heartbeat`).send({ s: 20 + i, t: 5, hull: 100 })),
        a.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'shift', s: 30, t: 5, hull: 100 }),
      ]);
      expect(end.status).toBe(200);
      expect(['completed', 'abandoned', 'failed']).toContain(end.body.status);
      expect(beats.every((r) => r.status === 200 || r.status === 409)).toBe(true);
      expect((await a.agent.get(`/api/rides/${ride.id}`)).body.status).not.toBe('running');
      void server;
    }
  });

  it('statistics: riders ending rides at the same moment all land on the one global row – exact sums, and the totals equal what the rides say (no drift)', async () => {
    const riders = await Promise.all(Array.from({ length: PARALLEL }, () => login()));
    const ids = await Promise.all(riders.map(async (r) => { const ride = (await r.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body; await r.agent.post(`/api/rides/${ride.id}/start`).expect(200); return ride.id as string; }));
    sec(5);
    const ends = await Promise.all(riders.map((r, i) => r.agent.post(`/api/rides/${ids[i]}/end`).send({ outcome: 'failed', s: 10 * (i + 1), t: 5, hull: 0, crashesVehicle: 1, reason: 'crash' })));
    expect(ends.every((e) => e.status === 200)).toBe(true);
    const total = Array.from({ length: PARALLEL }, (_, i) => 10 * (i + 1)).reduce((a, b) => a + b, 0);
    expect((await anon().get('/api/stats').expect(200)).body).toMatchObject({ rides: PARALLEL, metres: total, crashesVehicle: PARALLEL, drivers: PARALLEL });
    const bus = harness.app.get(CommandBus);
    expect(await bus.execute(new ReconcileStatsCommand(null, false))).toMatchObject({ checked: PARALLEL, drifted: [], global: null });
  });

  it('statistics: the sweep, a late heartbeat and /end racing for one ride count it exactly once', async () => {
    for (let round = 0; round < 4; round++) {
      const a = await login();
      const ride = (await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      await a.agent.post(`/api/rides/${ride.id}/start`).expect(200);
      sec(5); await a.agent.post(`/api/rides/${ride.id}/heartbeat`).send({ s: 30, t: 5, hull: 100 }).expect(200);
      sec(160);
      await Promise.all([
        harness.app.get(CommandBus).execute(new SweepStaleRidesCommand()),
        a.agent.post(`/api/rides/${ride.id}/heartbeat`).send({ s: 31, t: 6, hull: 100 }),
        a.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'failed', s: 31, t: 6, hull: 0 }),
      ]);
      expect((await a.agent.get('/api/profile').expect(200)).body.career.rides).toBe(1);
    }
    expect(await harness.app.get(CommandBus).execute(new ReconcileStatsCommand(null, false))).toMatchObject({ drifted: [], global: null });
  });

  it('statistics: donations from many spectators in parallel are all counted on the driver', async () => {
    const driver = await login();
    const ride = (await driver.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await driver.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    const fans = await Promise.all(Array.from({ length: PARALLEL }, () => login()));
    const res = await Promise.all(fans.map((f) => f.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: 'tip' })));
    const ok = res.filter((r) => r.status === 200).length;
    expect(ok).toBe(PARALLEL);
    expect((await driver.agent.get('/api/profile').expect(200)).body.career.donations).toBe(PARALLEL);
    expect((await anon().get('/api/stats').expect(200)).body.donations).toBe(PARALLEL);
  });

  it('statistics: a FIRST donation and the driver\'s ride ending at the same moment (no stats row yet) never deadlock – both are counted', async () => {
    for (let round = 0; round < 6; round++) {
      const driver = await login(), fan = await login();
      const ride = (await driver.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      await driver.agent.post(`/api/rides/${ride.id}/start`).expect(200);
      sec(3);
      const [end, tip] = await Promise.all([
        driver.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'failed', s: 10, t: 3, hull: 0 }),
        fan.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: 'tip' }),
      ]);
      expect(end.status).toBe(200);
      expect([200, 409]).toContain(tip.status);   // a tip that lands after the end is refused (409) – never a 500
      const career = (await driver.agent.get('/api/profile').expect(200)).body.career;
      expect(career.rides).toBe(1);
      expect(career.donations).toBe(tip.status === 200 ? 1 : 0);
    }
    expect(await harness.app.get(CommandBus).execute(new ReconcileStatsCommand(null, false))).toMatchObject({ drifted: [], global: null });
  });
});

