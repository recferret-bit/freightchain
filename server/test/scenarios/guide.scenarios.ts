import { bindClient, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/* The free ride's TUTORIAL and ASSIST (the lobby's two checkboxes): chosen when the ride is ordered, stored on the ride, handed to the game in the ride DTO;
   starting a ride with the tutorial on marks the player (`tutorialPassed` in /api/me); assist is free-only and never counts for the "On My Own" achievement.
   Free shift (EASY) = 10 s driven AND 84 m. Same scenarios on in-memory and PostgreSQL. */
export const GUIDE_ENV = { FREE_RIDE_SECONDS: '10' };

export function guideScenarios(h: () => Harness): void {
  const { login, sec } = bindClient(h);
  beforeEach(() => h().reset());

  const order = async (w: Rider, flags: Record<string, unknown> = {}) => (await w.agent.post('/api/rides').send({ tier: 'free', ...flags }).expect(200)).body;
  const start = async (w: Rider, id: string) => (await w.agent.post(`/api/rides/${id}/start`).expect(200)).body;
  const me = async (w: Rider) => (await w.agent.get('/api/me').expect(200)).body;
  const complete = async (w: Rider, flags: Record<string, unknown>) => {   // order → start → a complete 10 s / 84 m shift (EASY: 0.3 × 28 × 10) → end
    const id = (await order(w, flags)).id;
    await start(w, id);
    for (const [i, s] of [30, 60, 90].entries()) { sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ hull: 100, s, t: (i + 1) * 5 }).expect(200); }
    const end = (await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 90, t: 15, hull: 100 }).expect(200)).body;
    expect(end.status).toBe('completed');
    return id;
  };
  const earned = async (w: Rider, id: string) => (await w.agent.get('/api/profile').expect(200)).body.achievements.find((a: { id: string }) => a.id === id).earnedAt as number | null;

  it('a free ride is ordered without helpers by default; the ride and /api/me say so', async () => {
    const w = await login(), ride = await order(w);
    expect(ride).toMatchObject({ tier: 'free', tutorial: false, assist: false });
    expect((await w.agent.get(`/api/rides/${ride.id}`).expect(200)).body).toMatchObject({ tutorial: false, assist: false });
    expect(await me(w)).toMatchObject({ tutorialPassed: false });
  });

  it('the checkboxes are stored on the ride and handed to the game; the tutorial is PASSED when the ride STARTS (not when it is ordered), and only the first time', async () => {
    const w = await login(), ride = await order(w, { tutorial: true, assist: true });
    expect(ride).toMatchObject({ tutorial: true, assist: true });
    expect((await w.agent.get(`/api/rides/${ride.id}`).expect(200)).body).toMatchObject({ tutorial: true, assist: true });
    expect(await me(w)).toMatchObject({ tutorialPassed: false });          // ordered, not started: it can still be cancelled
    expect(await start(w, ride.id)).toMatchObject({ status: 'running', tutorial: true, assist: true });
    expect(await me(w)).toMatchObject({ tutorialPassed: true });
    await w.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'failed', s: 5, t: 1, hull: 0, reason: 'You drove into a sedan' }).expect(200);
    const next = await order(w, { tutorial: false });                       // the lobby now leaves it off by default
    expect(next).toMatchObject({ tutorial: false, assist: false });
    await start(w, next.id);
    expect(await me(w)).toMatchObject({ tutorialPassed: true });             // never un-passed
  });

  it('a ride started with assist only does not pass the tutorial', async () => {
    const w = await login(), ride = await order(w, { assist: true });
    await start(w, ride.id);
    expect(await me(w)).toMatchObject({ tutorialPassed: false });
  });

  it('a ready free ride can be re-chosen: the same ride comes back with the new checkboxes and no second credit is spent', async () => {
    const w = await login(), first = await order(w, { tutorial: true });
    const again = await order(w, { assist: true });
    expect(again).toMatchObject({ id: first.id, tutorial: false, assist: true });
    expect((await w.agent.get(`/api/rides/${first.id}`).expect(200)).body).toMatchObject({ tutorial: false, assist: true });
    expect((await me(w)).freeRides).toBe(9);
  });

  it('a running ride keeps what it started with', async () => {
    const w = await login(), ride = await order(w, { tutorial: true, assist: true });
    await start(w, ride.id);
    await w.agent.post('/api/rides').send({ tier: 'free', assist: false }).expect(409);   // "a ride is already in progress"
    expect((await w.agent.get(`/api/rides/${ride.id}`).expect(200)).body).toMatchObject({ tutorial: true, assist: true });
  });

  it('a paid tier refuses the helpers – assist never reaches a ranked ride – and nothing is created; garbage is a 400', async () => {
    const w = await login();
    await w.agent.post('/api/rides').send({ tier: '1h', assist: true }).expect(409);
    await w.agent.post('/api/rides').send({ tier: '1h', tutorial: true }).expect(409);
    await w.agent.post('/api/rides').send({ tier: 'free', assist: 'yes' }).expect(400);
    await w.agent.post('/api/rides').send({ tier: 'free', tutorial: 1 }).expect(400);
    expect((await w.agent.get('/api/rides/pending').expect(200)).body).toEqual({ ride: null });
    expect((await me(w)).freeRides).toBe(10);
  });

  it('"On My Own" = a free ride COMPLETED without assist: an assisted completion does not earn it, an unassisted one does (the tutorial does not matter)', async () => {
    const w = await login();
    expect(await earned(w, 'on-my-own')).toBeNull();
    await complete(w, { assist: true, tutorial: true });
    expect(await earned(w, 'free-easy')).not.toBeNull();
    expect(await earned(w, 'on-my-own')).toBeNull();
    await complete(w, { tutorial: true });
    expect(await earned(w, 'on-my-own')).not.toBeNull();
  });
}
