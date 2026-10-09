import { CommandBus } from '@nestjs/cqrs';
import request from 'supertest';
import { GrantDailyFreeRidesCommand } from '../../src/application/use-cases/players/grant-daily-free-rides/grant-daily-free-rides.command.js';
import { bindClient, newWallet as wallet, sign } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/* Wallet sign-in → free rides → ride lifecycle. The SAME scenarios run on in-memory repositories (test/http) and on real PostgreSQL (test/integration).
   (No browser wallet here: a tweetnacl keypair signs exactly what Phantom's signMessage would.) Free shift = 10 s driven AND 0.5·28·10 = 140 m. */
export const FLOW_ENV = { FREE_RIDE_SECONDS: '10' };

export function flowScenarios(h: () => Harness): void {
  const { anon, login, sec, server } = bindClient(h);
  beforeEach(() => h().reset());

  describe('sign-in with Solana', () => {
    it('signs in, sets an httpOnly cookie, and starts with 10 free rides', async () => {
      const w = wallet(), agent = request.agent(server());
      const { body: ch } = await agent.post('/api/auth/nonce').send({ wallet: w.address }).expect(200);
      expect(ch.message).toContain(w.address);
      const res = await agent.post('/api/auth/verify').send({ wallet: w.address, signature: sign(w.kp, ch.message) }).expect(200);
      expect(res.headers['set-cookie'][0]).toMatch(/fc_session=.*HttpOnly/);
      expect(res.body).toMatchObject({ wallet: w.address, freeRides: 10, freeRidesMax: 5 });
      await agent.get('/api/me').expect(200);
    });

    it('rejects: no session, a signature from another key, a replayed or expired challenge, a non-address', async () => {
      await anon().get('/api/me').expect(401);
      const a = wallet(), b = wallet();
      let { body } = await anon().post('/api/auth/nonce').send({ wallet: a.address });
      await anon().post('/api/auth/verify').send({ wallet: a.address, signature: sign(b.kp, body.message) }).expect(401);   // wrong key
      await anon().post('/api/auth/verify').send({ wallet: a.address, signature: sign(a.kp, body.message) }).expect(401);   // challenge already burnt by the failed try
      ({ body } = await anon().post('/api/auth/nonce').send({ wallet: a.address }));
      const good = sign(a.kp, body.message);
      await anon().post('/api/auth/verify').send({ wallet: a.address, signature: good }).expect(200);
      await anon().post('/api/auth/verify').send({ wallet: a.address, signature: good }).expect(401);                          // replay
      ({ body } = await anon().post('/api/auth/nonce').send({ wallet: a.address }));
      sec(301);
      await anon().post('/api/auth/verify').send({ wallet: a.address, signature: sign(a.kp, body.message) }).expect(401);    // expired
      await anon().post('/api/auth/nonce').send({ wallet: 'hello' }).expect(400);
    });

    it('cannot sign a message the server did not issue', async () => {
      const a = wallet(), agent = request.agent(server());
      await agent.post('/api/auth/nonce').send({ wallet: a.address });
      await agent.post('/api/auth/verify').send({ wallet: a.address, signature: sign(a.kp, 'sign in as me') }).expect(401);
    });
  });

  describe('free rides', () => {
    it('spends a credit per ride, reuses an unstarted ride, grants +1 per UTC day', async () => {
      const { agent } = await login();
      const r1 = (await agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      expect(r1).toMatchObject({ status: 'created', minSeconds: 10, completeDist: 70, trip: 'free-1', level: 1 });   // the free run's line: 0.25 × 28 × 10 (no level asked = EASY)
      expect((await agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body.id).toBe(r1.id);   // same unstarted ride, no 2nd credit
      expect((await agent.get('/api/me')).body.freeRides).toBe(9);
      await agent.post('/api/rides').send({ tier: 'paid1h' }).expect(400);
      sec(86_400);
      expect((await agent.get('/api/me')).body.freeRides).toBe(9);   // still above the daily cap of 5: no refill, nothing taken
      expect((await agent.get('/api/me')).body.freeRides).toBe(9);
    });

    it('the midnight job tops up everyone below the cap by one, never above it, once a day; /api/me counts down to the next one', async () => {
      const grant = () => h().app.get(CommandBus).execute(new GrantDailyFreeRidesCommand()) as Promise<{ day: string; players: number }>;
      const spendOne = async (agent: ReturnType<typeof request.agent>) => {
        const r = (await agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
        await agent.post(`/api/rides/${r.id}/start`).expect(200);
        await agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'failed', s: 0, reason: 'test' }).expect(200);
      };
      const a = await login(), b = await login();
      const me = async (agent: ReturnType<typeof request.agent>) => (await agent.get('/api/me').expect(200)).body;
      expect(await me(b.agent)).toMatchObject({ freeRides: 10, freeRidesMax: 5, nextFreeRideAt: null });   // above the daily cap: no timer
      for (let i = 0; i < 7; i++) await spendOne(a.agent);                           // 10 → 3, under the cap
      const midnight = Math.floor(h().clock.ms / 86_400_000) * 86_400_000 + 86_400_000;
      expect(await me(a.agent)).toMatchObject({ freeRides: 3, freeRidesMax: 5, nextFreeRideAt: midnight });
      expect((await grant()).players).toBe(0);                                      // same UTC day: nothing to give yet
      h().clock.ms = midnight + 1;                                                 // 00:00:00.001 UTC – nobody has opened the app
      expect((await grant()).players).toBe(2);
      expect((await grant()).players).toBe(0);                                      // once a day
      expect(await me(a.agent)).toMatchObject({ freeRides: 4, nextFreeRideAt: midnight + 86_400_000 });
      expect(await me(b.agent)).toMatchObject({ freeRides: 10, nextFreeRideAt: null });   // surplus stays; the cap does not take it
      sec(86_400); await grant(); await grant();
      expect((await me(a.agent)).freeRides).toBe(5);
      expect((await me(a.agent)).nextFreeRideAt).toBeNull();
      sec(86_400); await grant();
      expect((await me(a.agent)).freeRides).toBe(5);
      expect((await a.agent.get('/api/profile')).body).toMatchObject({ freeRides: 5, freeRidesMax: 5, nextFreeRideAt: null });
    });

    it('runs out after the free credits are spent', async () => {
      const { agent } = await login();
      for (let i = 0; i < 10; i++) {
        const r = (await agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
        await agent.post(`/api/rides/${r.id}/start`).expect(200);
        await agent.post(`/api/rides/${r.id}/end`).send({ outcome: 'failed', s: 0, reason: 'test' }).expect(200);
      }
      await agent.post('/api/rides').send({ tier: 'free' }).expect(409);
    });
  });

  describe('ride lifecycle (server decides)', () => {
    const begin = async (agent: ReturnType<typeof request.agent>) => {
      const r = (await agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      await agent.post(`/api/rides/${r.id}/start`).expect(200);
      return r.id as string;
    };

    it('completes after the minimum time AND distance; pausing earns no time', async () => {
      const { agent } = await login(), id = await begin(agent), hb = (s: number, paused = false) => agent.post(`/api/rides/${id}/heartbeat`).send({ s, hull: 100, paused });
      sec(5); expect((await hb(70).expect(200)).body.driveSeconds).toBe(5);
      sec(5); expect((await hb(140, true).expect(200)).body.driveSeconds).toBe(5);   // paused beat: wall time passes, drive time doesn't
      const end = await agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 140, hull: 90 }).expect(200);
      expect(end.body.status).toBe('abandoned');                                     // distance reached (140 m) but only 5 s driven of 10
    });

    it("credits the game's own clock: a pause mid-window and the stretch after the last beat both count", async () => {
      const { agent } = await login(), id = await begin(agent);
      sec(4); await agent.post(`/api/rides/${id}/heartbeat`).send({ s: 60, t: 4, hull: 100, paused: false }).expect(200);
      sec(7);   // 4 s driven before the beat, then 4 more (with a 3 s pause inside this window) → the game clock reads t = 8, the wall clock 11
      const end = await agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 150, t: 10.5, hull: 80, paused: true }).expect(200);   // the end report always says paused (the game is in mode 'done')
      expect(end.body).toMatchObject({ status: 'completed', driveSeconds: 10.5 });   // 4 + 6.5, none of it lost to the paused flag
    });

    it('caps claimed drive time by the wall clock', async () => {
      const { agent } = await login(), id = await begin(agent);
      sec(2);
      const end = await agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 50, t: 500, hull: 100 }).expect(200);
      expect(end.body.status).toBe('abandoned');
      expect(end.body.driveSeconds).toBeLessThanOrEqual(2 * 1.05 + 1);
    });

    it('a garbled or out-of-range final report still ends the ride (hull clamped, bad s ignored)', async () => {
      const a = await login(), id = await begin(a.agent);
      sec(3);
      const end = await a.agent.post(`/api/rides/${id}/end`).send({ outcome: 'failed', reason: 'crash', s: 'NaN', t: 3, hull: -5 }).expect(200);
      expect(end.body.status).toBe('failed');
      await a.agent.post('/api/rides').send({ tier: 'free' }).expect(200);   // not blocked by a stuck 'running' ride
      const b = await login(), id2 = await begin(b.agent);
      sec(2); await b.agent.post(`/api/rides/${id2}/heartbeat`).send({ s: 'abc' }).expect(400);   // heartbeats stay strict
    });

    it('completed = driven ≥ min AND s ≥ dist', async () => {
      const { agent } = await login(), id = await begin(agent);
      for (const s of [70, 140, 150]) { sec(5); await agent.post(`/api/rides/${id}/heartbeat`).send({ s, hull: 100 }).expect(200); }
      const end = await agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 150, hull: 80 }).expect(200);
      expect(end.body).toMatchObject({ status: 'completed', distance: 150 });
    });

    it('idling does not bank a ride: time without distance is abandoned', async () => {
      const { agent } = await login(), id = await begin(agent);
      sec(60); await agent.post(`/api/rides/${id}/heartbeat`).send({ s: 5, hull: 100 }).expect(200);
      expect((await agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 5 }).expect(200)).body.status).toBe('abandoned');
    });

    it('fails a ride that teleports, and one whose heartbeats stop', async () => {
      const a = await login(), id = await begin(a.agent);
      sec(2); await a.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 5000, hull: 100 }).expect(200);
      expect((await a.agent.get(`/api/rides/${id}`)).body).toMatchObject({ status: 'failed' });
      expect((await a.agent.get(`/api/rides/${id}`)).body.reason).toMatch(/implausible/);
      const b = await login(), id2 = await begin(b.agent);
      sec(200); await b.agent.post(`/api/rides/${id2}/heartbeat`).send({ s: 10, hull: 100 }).expect(200);
      expect((await b.agent.get(`/api/rides/${id2}`)).body).toMatchObject({ status: 'failed', reason: 'heartbeat lost' });
    });

    it("is private to its owner, and a running ride blocks a second one", async () => {
      const a = await login(), b = await login(), id = await begin(a.agent);
      await b.agent.get(`/api/rides/${id}`).expect(404);
      await b.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 1 }).expect(404);
      await a.agent.post('/api/rides').send({ tier: 'free' }).expect(409);
      await anon().get(`/api/rides/${id}`).expect(401);
    });
  });
}
