import { CommandBus } from '@nestjs/cqrs';
import { GrantDailyFreeRidesCommand } from '../../src/application/use-cases/players/grant-daily-free-rides/grant-daily-free-rides.command.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { bindClient, newWallet, sign, type Rider } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';
import { recording } from '../support/recording.js';
import { TREASURY } from '../support/fake-chain.js';

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
    expect(await freeRides(a)).toBe(4);
  });

  it('N parallel paid orders for the same tier are ONE order', async () => {
    const a = await login();
    const results = await parallel(PARALLEL, () => a.agent.post('/api/rides').send({ tier: '1h' }));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await rideCount(a.address)).toBe(1);
  });

  it('parallel "buy while holding an unstarted free ride" refunds the credit ONCE', async () => {
    const a = await login();
    await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200);
    expect(await freeRides(a)).toBe(4);
    const results = await parallel(PARALLEL, () => a.agent.post('/api/rides').send({ tier: '1h' }));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await freeRides(a)).toBe(5); // refunded exactly once
    expect(await prisma.ride.count({ where: { wallet: a.address, status: 'cancelled' } })).toBe(1);
    expect(await prisma.ride.count({ where: { wallet: a.address, status: 'awaiting_payment' } })).toBe(1);
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
    await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200);   // 4 left
    sec(86_400);
    const bus = harness.app.get(CommandBus);
    await Promise.all([parallel(PARALLEL, () => a.agent.get('/api/me')), parallel(3, () => bus.execute(new GrantDailyFreeRidesCommand()))]);
    expect(await freeRides(a)).toBe(5);                                    // 4 + one credit for the new day
    await parallel(PARALLEL, () => a.agent.post('/api/rides').send({ tier: '1h' })); // refunds the unstarted free ride, which would be #6
    expect(await freeRides(a)).toBe(5);                                    // clamped at the cap
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
    const batches = recording(ride.id, { seconds: 40, distance: 560 });
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

  it('an admin decision racing re-judges from late batches: the decision is what stays', async () => {
    const admin = newWallet();
    const h2 = await createHarness('postgres', { FREE_RIDE_SECONDS: '10', ADMIN_WALLETS: admin.address });
    try {
      const c = bindClient(() => h2);
      const a = await c.login(), boss = await c.login(admin);
      const ride = (await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      await a.agent.post(`/api/rides/${ride.id}/start`).expect(200);
      const batches = recording(ride.id, { seconds: 10, distance: 140, batchSeconds: 2 });
      for (const b of batches.slice(0, 3)) await a.agent.post(`/api/rides/${ride.id}/batches`).send(b).expect(200);
      c.sec(10);
      await a.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'shift', s: 140, t: 10 }).expect(200);
      const results = await Promise.all([
        boss.agent.post(`/api/admin/rides/${ride.id}/verdict`).set('x-fc-admin', '1').send({ decision: 'rejected', note: 'race' }),
        ...batches.slice(3).map((b) => a.agent.post(`/api/rides/${ride.id}/batches`).send(b)),
      ]);
      expect(results.map((r) => r.status)).toEqual(results.map(() => 200));
      expect((await a.agent.get(`/api/rides/${ride.id}`).expect(200)).body.verdict).toMatchObject({ status: 'rejected', override: { by: admin.address, note: 'race' } });
      const p2 = h2.app.get(PrismaService, { strict: false });
      expect(await p2.adminAction.count()).toBe(1);
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

  it('a double START starts the ride once', async () => {
    const a = await login();
    const ride = (await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    const results = await parallel(PARALLEL, () => a.agent.post(`/api/rides/${ride.id}/start`));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(PARALLEL - 1);
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
});
