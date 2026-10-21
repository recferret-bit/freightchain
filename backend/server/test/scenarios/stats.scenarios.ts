import { CommandBus } from '@nestjs/cqrs';
import { SweepStaleRidesCommand } from '../../src/application/use-cases/rides/sweep-stale-rides/sweep-stale-rides.command.js';
import { ReconcileStatsCommand } from '../../src/application/use-cases/stats/reconcile-stats/reconcile-stats.command.js';
import { StatsRepositoryPort } from '../../src/application/ports/stats/stats.repository.port.js';
import { bindClient, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { setTierOnSaleForTest } from '../../src/domain/rides/ride-tier.js';
import { TREASURY } from '../support/fake-chain.js';

/* Statistics (docs/spec/platform_services.md): the running totals per rider and for the whole game – every started ride that ends counts what it drove (the bug this
   fixed: the landing counted only COMPLETE shifts, so a young game showed 0.00 km), plus time, crashes (vehicle / building) and donations during streams.
   Free shift = 10 s driven AND 140 m. Same scenarios on in-memory and PostgreSQL. */
export const STATS_ENV = { FREE_RIDE_SECONDS: '10' };
const ZERO = { rides: 0, ridesFree: 0, ridesPaid: 0, ridesCompleted: 0, seconds: 0, metres: 0, crashes: 0, crashesVehicle: 0, crashesBuilding: 0, donations: 0, donationLamports: 0 };

export function statsScenarios(h: () => Harness): void {
  const { anon, login, sec } = bindClient(h);
  beforeEach(() => { setTierOnSaleForTest('1h', true); return h().reset(); });
  afterEach(() => setTierOnSaleForTest('1h', false));

  const startFree = async (w: Rider) => { const r = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body; await w.agent.post(`/api/rides/${r.id}/start`).expect(200); return r.id as string; };
  const startPaid = async (w: Rider) => {
    const r = (await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    const sig = h().chain.addPayment({ payer: w.address, destination: TREASURY, lamports: r.lamports, memo: r.id });
    await w.agent.post(`/api/rides/${r.id}/confirm`).send({ signature: sig }).expect(200);
    await w.agent.post(`/api/rides/${r.id}/start`).expect(200);
    return r.id as string;
  };
  const beat = async (w: Rider, id: string, body: Record<string, unknown>) => { sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ hull: 100, ...body }).expect(200); };
  const stats = async () => (await anon().get('/api/stats').expect(200)).body;
  const career = async (w: Rider) => (await w.agent.get('/api/profile').expect(200)).body.career;

  it('GET /api/stats is public and starts at zero; the profile has an empty driving record', async () => {
    expect(await stats()).toEqual({ ...ZERO, drivers: 0, updatedAt: 0 });
    const w = await login();
    expect(await career(w)).toEqual(ZERO);
  });

  it('a ride that FAILED still counts what it drove – distance, time, a ride, no shift – for the rider and the game; the landing\'s totals follow', async () => {
    const w = await login(), id = await startFree(w);
    await beat(w, id, { s: 70, t: 5 });
    await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'failed', s: 82, t: 6, hull: 0, reason: 'You drove into a sedan' }).expect(200);
    expect(await stats()).toMatchObject({ rides: 1, ridesCompleted: 0, metres: 82, drivers: 1 });
    expect((await stats()).seconds).toBeGreaterThan(0);
    expect(await career(w)).toMatchObject({ rides: 1, ridesCompleted: 0, metres: 82 });
    expect((await anon().get('/api/live').expect(200)).body.totals).toMatchObject({ shifts: 0, rides: 1, metres: 82, drivers: 1 });
  });

  it('a complete shift counts as a ride AND a finished shift; two riders keep their own totals and add up in the game\'s', async () => {
    const a = await login(), b = await login();
    const idA = await startFree(a);
    for (const [i, s] of [60, 140, 150].entries()) await beat(a, idA, { s, t: (i + 1) * 5 });
    await a.agent.post(`/api/rides/${idA}/end`).send({ outcome: 'shift', s: 150, t: 15, hull: 100 }).expect(200);
    const idB = await startFree(b);
    await beat(b, idB, { s: 30, t: 5 });
    await b.agent.post(`/api/rides/${idB}/end`).send({ outcome: 'shift', s: 30, t: 5, hull: 100 }).expect(200);   // too early: abandoned
    expect(await career(a)).toMatchObject({ rides: 1, ridesCompleted: 1, metres: 150 });
    expect(await career(b)).toMatchObject({ rides: 1, ridesCompleted: 0, metres: 30 });
    expect(await stats()).toMatchObject({ rides: 2, ridesCompleted: 1, metres: 180, drivers: 2 });
  });

  it('crashes: the game reports running counts (vehicle / building) in every report; they only go up, are capped per ride and add to the totals once at the end', async () => {
    const w = await login(), id = await startFree(w);
    await beat(w, id, { s: 20, t: 5, crashesVehicle: 2 });
    await beat(w, id, { s: 40, t: 10, crashesVehicle: 1, crashesBuilding: 0 });   // a lower count never lowers it
    expect(await career(w)).toMatchObject({ crashes: 0 });                         // nothing until the ride ends
    await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'failed', s: 41, t: 10, hull: 0, crashesBuilding: 1, reason: 'You crashed into a building' }).expect(200);
    expect(await career(w)).toMatchObject({ crashesVehicle: 2, crashesBuilding: 1, crashes: 3 });
    expect(await stats()).toMatchObject({ crashesVehicle: 2, crashesBuilding: 1, crashes: 3 });
    const id2 = await startFree(w);
    await w.agent.post(`/api/rides/${id2}/end`).send({ outcome: 'failed', s: 1, t: 1, crashesVehicle: 1_000_000, crashesBuilding: 'many' }).expect(200);
    expect(await career(w)).toMatchObject({ crashesVehicle: 5, crashesBuilding: 1 });   // a ride that drove a second may report 3 crashes (3 + one per 3 s, ≤ 200); garbage is ignored
    await w.agent.post(`/api/rides/${id2}/heartbeat`).send({ s: 1, crashesVehicle: 'x' }).expect(409);   // an ended ride takes no more reports
  });

  it('a ride the stale-ride sweeper ends counts too, once', async () => {
    const w = await login(), id = await startFree(w);
    await beat(w, id, { s: 70, t: 5 });
    sec(160);
    expect(await h().app.get(CommandBus).execute(new SweepStaleRidesCommand())).toEqual({ ended: 1, skipped: 0 });
    await h().app.get(CommandBus).execute(new SweepStaleRidesCommand());
    expect(await career(w)).toMatchObject({ rides: 1, metres: 70 });
    expect(await stats()).toMatchObject({ rides: 1, metres: 70 });
  });

  it('a ride that never started (a refunded / replaced free ride) counts nothing', async () => {
    const w = await login();
    await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200);
    expect(await career(w)).toEqual(ZERO);
    expect(await stats()).toMatchObject({ rides: 0, drivers: 0 });
  });

  it('donations during a stream count on the DRIVER (the spectator\'s own record stays empty); chat does not; free rides refuse stream interactions', async () => {
    const driver = await login(), fan = await login();
    const freeId = await startFree(driver);
    await fan.agent.post(`/api/watch/${freeId}/messages`).send({ text: 'go go' }).expect(403);
    await fan.agent.post(`/api/watch/${freeId}/donations`).send({ effect: 'tip' }).expect(404);
    await driver.agent.post(`/api/rides/${freeId}/end`).send({ outcome: 'failed', s: 0, t: 1 }).expect(200);
    const id = await startPaid(driver);
    await fan.agent.post(`/api/watch/${id}/messages`).send({ text: 'go go' }).expect(200);
    await driver.agent.post(`/api/rides/${id}/end`).send({ outcome: 'failed', s: 1, t: 1 }).expect(200);
    await fan.agent.post(`/api/watch/${id}/donations`).send({ effect: 'tip' }).expect(200);
    expect(await career(driver)).toMatchObject({ donations: 1, donationLamports: 0 });   // a mock tip: counted, no lamports
    expect(await career(fan)).toMatchObject({ donations: 0 });
    expect(await stats()).toMatchObject({ donations: 1 });
  });

  it('the numbers are cached, and every write drops the cache: a read right after a ride ends is never stale', async () => {
    const w = await login();
    expect((await stats()).rides).toBe(0);                      // cached
    const id = await startFree(w);
    await beat(w, id, { s: 20, t: 5 });
    await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'failed', s: 20, t: 5 }).expect(200);
    expect((await stats()).rides).toBe(1);
    expect((await career(w)).rides).toBe(1);
  });

  it('reconcile: a lost write is found and repaired from the rides themselves', async () => {
    const w = await login(), id = await startFree(w);
    await beat(w, id, { s: 70, t: 5 });
    await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'failed', s: 70, t: 5 }).expect(200);
    const bus = h().app.get(CommandBus);
    expect(await bus.execute(new ReconcileStatsCommand(null, false))).toMatchObject({ checked: 1, drifted: [], days: [], fixed: false });
    // a lost write: the rider's row and the game's row both miss the ride (what a crash between two statements, or a hand-edited row, leaves behind)
    await h().app.get(StatsRepositoryPort).add(w.address, { rides: -1, ridesFree: -1, ridesPaid: 0, ridesCompleted: 0, seconds: -3, metres: -70, crashesVehicle: 0, crashesBuilding: 0, donations: 0, donationLamports: 0 }, new Date(h().clock.ms));
    expect(await bus.execute(new ReconcileStatsCommand(w.address, false))).toMatchObject({ drifted: [{ wallet: w.address, fields: { rides: { stored: 0, truth: 1 }, metres: { stored: 0, truth: 70 } } }], global: null, fixed: false });
    expect(await bus.execute(new ReconcileStatsCommand(null, false))).toMatchObject({ global: { rides: { stored: 0, truth: 1 } } });
    expect(await bus.execute(new ReconcileStatsCommand(null, true))).toMatchObject({ fixed: true });
    expect(await bus.execute(new ReconcileStatsCommand(null, false))).toMatchObject({ drifted: [], global: null, fixed: false });
    expect(await career(w)).toMatchObject({ rides: 1, metres: 70 });
    expect(await stats()).toMatchObject({ rides: 1, metres: 70 });
  });

  it('the history: GET /api/stats/daily is public, one row per UTC day with activity – the days add up to the totals', async () => {
    expect((await anon().get('/api/stats/daily').expect(200)).body).toEqual([]);
    const w = await login(), id = await startFree(w);
    await beat(w, id, { s: 70, t: 5 });
    await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'failed', s: 70, t: 5, crashesVehicle: 1 }).expect(200);
    const days = (await anon().get('/api/stats/daily').expect(200)).body;
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ rides: 1, ridesFree: 1, ridesPaid: 0, metres: 70, crashesVehicle: 1 });
    expect(days[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(days[0])).not.toContain('wallet');
    const total = await stats();
    expect(days.reduce((s: number, d: { rides: number }) => s + d.rides, 0)).toBe(total.rides);
    sec(86_400 + 10);   // the next UTC day: a second row, the first one untouched
    const id2 = await startFree(w);
    await beat(w, id2, { s: 30, t: 5 });
    await w.agent.post(`/api/rides/${id2}/end`).send({ outcome: 'failed', s: 30, t: 5 }).expect(200);
    const two = (await anon().get('/api/stats/daily').expect(200)).body;
    expect(two.map((d: { metres: number }) => d.metres)).toEqual([70, 30]);
  });
}
