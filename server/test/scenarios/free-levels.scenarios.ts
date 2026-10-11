import { bindClient, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/* The free ride's three LEVELS (the lobby's picker – ride-trip.ts FREE_LEVELS): EASY = FREE_RIDE_SECONDS × 1 at K .25 on trip free-1, CROSSROADS = × 3
   at K .3 on free-2, HARD = × 10 at K .4 on free-3 and no TUTORIAL or ASSIST. Picked when the ride is ordered, stored on the ride (trip, minSeconds, completeDist),
   offered by GET /api/tiers, re-chosen on the ready ride, and each one cleared unlocks its achievement. Same scenarios on in-memory and PostgreSQL. */
export const FREE_LEVELS_ENV = { FREE_RIDE_SECONDS: '60' };

const dist = (k: number, s: number): number => k * 28 * s;

export function freeLevelScenarios(h: () => Harness): void {
  const { anon, login, sec } = bindClient(h);
  beforeEach(() => h().reset());

  const order = async (w: Rider, body: Record<string, unknown> = {}) => (await w.agent.post('/api/rides').send({ tier: 'free', ...body }).expect(200)).body;
  const me = async (w: Rider) => (await w.agent.get('/api/me').expect(200)).body;
  const earned = async (w: Rider, id: string) => (await w.agent.get('/api/profile').expect(200)).body.achievements.find((a: { id: string }) => a.id === id).earnedAt as number | null;
  /** order → start → heartbeats every 30 s up to the shift's time and a bit past its line → end: completed */
  const clear = async (w: Rider, level: number) => {
    const ride = await order(w, { level });
    await w.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    const beats = Math.ceil(ride.minSeconds / 30), to = ride.completeDist + 10;
    for (let i = 1; i <= beats; i++) { sec(30); await w.agent.post(`/api/rides/${ride.id}/heartbeat`).send({ hull: 100, s: Math.round((to * i) / beats), t: 30 * i }).expect(200); }
    const end = (await w.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'shift', s: to, t: 30 * beats, hull: 100 }).expect(200)).body;
    expect(end).toMatchObject({ status: 'completed', level });
    return ride;
  };

  it('GET /api/tiers offers the three levels on the free tier: name, trip, length, finish line, assist – the free row itself is EASY', async () => {
    const free = (await anon().get('/api/tiers').expect(200)).body.tiers.find((t: { id: string }) => t.id === 'free');
    expect(free).toMatchObject({ seconds: 60, completeDist: dist(0.25, 60) });
    expect(free.levels).toEqual([
      { level: 1, trip: 'free-1', name: 'EASY', seconds: 60, completeDist: dist(0.25, 60), tutorial: true, assist: true },
      { level: 2, trip: 'free-2', name: 'CROSSROADS', seconds: 180, completeDist: dist(0.3, 180), tutorial: true, assist: true },
      { level: 3, trip: 'free-3', name: 'HARD', seconds: 600, completeDist: dist(0.4, 600), tutorial: false, assist: false },
    ]);
    const paid = (await anon().get('/api/tiers').expect(200)).body.tiers.filter((t: { id: string }) => t.id !== 'free');
    for (const t of paid) expect(t.levels).toBeUndefined();
  });

  it('a free ride with no level is EASY: trip free-1, the plain FREE_RIDE_SECONDS, K .25', async () => {
    const w = await login(), ride = await order(w);
    expect(ride).toMatchObject({ tier: 'free', level: 1, trip: 'free-1', minSeconds: 60, completeDist: dist(0.25, 60) });
  });

  it('level 2 = CROSSROADS: trip free-2, 180 s and K .3, kept on the ride and in the watch payload', async () => {
    const w = await login(), ride = await order(w, { level: 2 });
    expect(ride).toMatchObject({ level: 2, trip: 'free-2', minSeconds: 180, completeDist: dist(0.3, 180) });
    expect((await w.agent.get(`/api/rides/${ride.id}`).expect(200)).body).toMatchObject({ level: 2, trip: 'free-2', minSeconds: 180 });
    await w.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    expect((await anon().get(`/api/watch/${ride.id}`).expect(200)).body.ride).toMatchObject({ level: 2, trip: 'free-2', minSeconds: 180 });
  });

  it('HARD has no assist: level 3 with assist is a 409 and nothing is ordered; without it it is free-3, 600 s, K .4', async () => {
    const w = await login();
    const refused = (await w.agent.post('/api/rides').send({ tier: 'free', level: 3, assist: true }).expect(409)).body;
    expect(refused).toMatchObject({ code: 'assist_not_allowed', detail: 'the HARD free run has no assist' });
    expect((await me(w)).freeRides).toBe(10);
    const tutorial = (await w.agent.post('/api/rides').send({ tier: 'free', level: 3, tutorial: true }).expect(409)).body;
    expect(tutorial).toMatchObject({ code: 'tutorial_not_allowed', detail: 'the HARD free run has no tutorial' });
    expect((await me(w)).freeRides).toBe(10);
    expect(await order(w, { level: 3 })).toMatchObject({ level: 3, trip: 'free-3', minSeconds: 600, completeDist: dist(0.4, 600), assist: false, tutorial: false });
  });

  it('a level is for free rides only (409), and only 1, 2 or 3 (400)', async () => {
    const w = await login();
    expect((await w.agent.post('/api/rides').send({ tier: '1h', level: 1 }).expect(409)).body.code).toBe('level_free_only');
    for (const level of [0, 4, 1.5, '2', null]) await w.agent.post('/api/rides').send({ tier: 'free', level }).expect(400);
    expect((await me(w)).freeRides).toBe(10);
  });

  it('the ready free ride is re-chosen at another level: the SAME ride and credit, its trip / length / line moved; HARD + assist leaves it alone', async () => {
    const w = await login(), first = await order(w, { level: 2, assist: true });
    const hard = await order(w, { level: 3 });                                // assist off in the same request: allowed
    expect(hard).toMatchObject({ id: first.id, level: 3, trip: 'free-3', minSeconds: 600, completeDist: dist(0.4, 600), assist: false });
    await w.agent.post('/api/rides').send({ tier: 'free', level: 3, assist: true }).expect(409);
    expect((await w.agent.get(`/api/rides/${first.id}`).expect(200)).body).toMatchObject({ level: 3, assist: false });
    expect(await order(w, { level: 1, assist: true })).toMatchObject({ id: first.id, level: 1, trip: 'free-1', minSeconds: 60, assist: true });
    expect((await me(w)).freeRides).toBe(9);
  });

  it('ordering the ready free ride again WITHOUT a level keeps its level (HARD stays HARD) – only the helpers change', async () => {
    const w = await login(), hard = await order(w, { level: 3 });
    expect(await order(w)).toMatchObject({ id: hard.id, level: 3, trip: 'free-3', minSeconds: 600, completeDist: dist(0.4, 600), tutorial: false });
    expect((await w.agent.post('/api/rides').send({ tier: 'free', assist: true }).expect(409)).body.code).toBe('assist_not_allowed');   // still HARD: no assist
    expect(await order(w, { level: 2 })).toMatchObject({ id: hard.id, level: 2, trip: 'free-2' });
    expect(await order(w, { tutorial: true })).toMatchObject({ id: hard.id, level: 2, trip: 'free-2', tutorial: true });
    expect((await me(w)).freeRides).toBe(9);
  });

  it('a start that names the trip the game built: re-chosen in the lobby meanwhile = 409 ride_rechosen and the ride stays ready; the right trip (or none) starts it', async () => {
    const w = await login(), ride = await order(w, { level: 1 });             // the game tab reads it: free-1
    await order(w, { level: 3 });                                              // another tab re-chooses HARD before the game presses START
    const refused = (await w.agent.post(`/api/rides/${ride.id}/start`).send({ trip: 'free-1' }).expect(409)).body;
    expect(refused).toMatchObject({ code: 'ride_rechosen' });
    expect((await w.agent.get(`/api/rides/${ride.id}`).expect(200)).body).toMatchObject({ status: 'created', trip: 'free-3' });
    await w.agent.post(`/api/rides/${ride.id}/start`).send({ trip: '' }).expect(400);
    expect((await w.agent.post(`/api/rides/${ride.id}/start`).send({ trip: 'free-3' }).expect(200)).body).toMatchObject({ status: 'running', trip: 'free-3', level: 3 });
    const other = await login(), plain = await order(other, { level: 2 });
    expect((await other.agent.post(`/api/rides/${plain.id}/start`).expect(200)).body.status).toBe('running');   // no trip in the body: not compared
  });

  it('clearing each level unlocks its own achievement – EASY, CROSSROADS, HARD – and nothing else of the three', async () => {
    const w = await login();
    for (const id of ['free-easy', 'free-crossroads', 'free-hard']) expect(await earned(w, id)).toBeNull();
    await clear(w, 1);
    expect(await earned(w, 'free-easy')).not.toBeNull();
    expect(await earned(w, 'free-crossroads')).toBeNull();
    await clear(w, 2);
    expect(await earned(w, 'free-crossroads')).not.toBeNull();
    expect(await earned(w, 'free-hard')).toBeNull();
    await clear(w, 3);
    expect(await earned(w, 'free-hard')).not.toBeNull();
  });

  it('the free leaderboard ranks ONE level: ?level=1|2|3, HARD when absent – one HARD run does not bury the EASY riders', async () => {
    const hard = await login(), easy = await login();
    await clear(hard, 3);
    await clear(easy, 1); await clear(easy, 1);
    const board = async (q: string) => (await anon().get(`/api/leaderboard?board=free${q}`).expect(200)).body;
    expect(await board('')).toMatchObject({ board: 'free', level: 3, rows: [{ rank: 1, wallet: hard.address, rides: 1 }] });
    expect((await board('')).rows).toHaveLength(1);
    expect(await board('&level=1')).toMatchObject({ level: 1, rows: [{ rank: 1, wallet: easy.address, rides: 2 }] });
    expect((await board('&level=1')).rows).toHaveLength(1);
    expect(await board('&level=2')).toMatchObject({ level: 2, rows: [] });
    expect((await anon().get('/api/leaderboard?board=round&level=3').expect(400)).body.status).toBe(400);
  });

  it('at 0 credits the READY free ride is still yours: /api/me shows it, ordering again re-chooses it without a credit, and once it starts it is gone', async () => {
    const w = await login();
    expect((await me(w)).readyFreeRide).toBeNull();
    const spend = async () => { const r = await order(w); await w.agent.post(`/api/rides/${r.id}/start`).expect(200); await w.agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'failed', s: 0, t: 0, reason: 'test' }).expect(200); };
    for (let n = (await me(w)).freeRides; n > 1; n--) await spend();
    const ready = await order(w, { level: 3 });                                                    // the last credit
    expect(await me(w)).toMatchObject({ freeRides: 0, readyFreeRide: { id: ready.id, level: 3, trip: 'free-3', tutorial: false, assist: false } });
    const again = await order(w, { level: 2, assist: true });                                       // re-chosen: same ride, no credit needed
    expect(again).toMatchObject({ id: ready.id, level: 2, trip: 'free-2', assist: true, status: 'created' });
    expect(await me(w)).toMatchObject({ freeRides: 0, readyFreeRide: { id: ready.id, level: 2, trip: 'free-2', tutorial: false, assist: true } });
    await w.agent.post(`/api/rides/${ready.id}/start`).expect(200);
    expect(await me(w)).toMatchObject({ freeRides: 0, readyFreeRide: null });
    await w.agent.post(`/api/rides/${ready.id}/end`).send({ outcome: 'failed', s: 0, t: 0, reason: 'test' }).expect(200);
    expect((await w.agent.post('/api/rides').send({ tier: 'free' })).status).toBe(409);            // no credit and no ready ride: nothing to hand out
    expect((await me(w)).readyFreeRide).toBeNull();
  });

  it('a level abandoned before its time clears nothing', async () => {
    const w = await login(), ride = await order(w, { level: 2 });
    await w.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    sec(60); await w.agent.post(`/api/rides/${ride.id}/heartbeat`).send({ hull: 100, s: 600, t: 60 }).expect(200);   // EASY's time and more than its line, but this is CROSSROADS
    expect((await w.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'shift', s: 600, t: 60, hull: 100 }).expect(200)).body.status).toBe('abandoned');
    for (const id of ['free-easy', 'free-crossroads']) expect(await earned(w, id)).toBeNull();
  });
}
