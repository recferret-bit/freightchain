import { CommandBus } from '@nestjs/cqrs';
import { SweepStaleRidesCommand } from '../../src/application/use-cases/rides/sweep-stale-rides/sweep-stale-rides.command.js';
import { bindClient, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/* The lobby: live feed, profile + persisted achievements, route / night in heartbeats, free ride vs paid purchase, leaderboard boards.
   Free shift = 10 s driven AND 140 m; the fake clock and fake chain drive everything. */
export const LOBBY_ENV = { FREE_RIDE_SECONDS: '10' };

export function lobbyScenarios(h: () => Harness): void {
  const { anon, login, sec, now } = bindClient(h);
  beforeEach(() => h().reset());

  const freeRide = async (w: Rider) => { const r = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body; await w.agent.post(`/api/rides/${r.id}/start`).expect(200); return r.id as string; };
  /** drive a free ride to completion (10 s, 140 m) */
  async function finish(w: Rider, extra: Record<string, unknown> = {}, hull = 100) {
    const id = await freeRide(w);
    for (const [i, s] of [60, 140, 150].entries()) { sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s, t: (i + 1) * 5, hull, ...extra }).expect(200); }
    return (await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 150, t: 15, hull, ...extra }).expect(200)).body;
  }
  describe('live feed (public)', () => {
    it('shows running rides with route, progress, pause state and the ride id (the watch link) – no seed or reason', async () => {
      const w = await login(), id = await freeRide(w);
      sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 70, t: 5, hull: 80, route: 'brenner', night: false }).expect(200);
      const { body } = await anon().get('/api/live').expect(200);   // no cookie
      const mine = body.rides.find((r: { wallet: string }) => r.wallet === w.address);
      expect(mine).toMatchObject({ tier: 'free', route: 'brenner', distance: 70, hull: 80, paused: false, driveSeconds: 5, minSeconds: 10, completeDist: 140, timeScale: 1 });
      expect(mine.progress).toBeCloseTo(0.5, 2);
      expect(mine.id).toBe(id); expect(Object.keys(mine)).not.toContain('reason'); expect(Object.keys(mine)).not.toContain('seed');
      sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 70, t: 5, hull: 80, paused: true }).expect(200);
      expect((await anon().get('/api/live')).body.rides.find((r: { wallet: string }) => r.wallet === w.address).paused).toBe(true);
    });

    it('drops a ride whose tab vanished (no heartbeat for a while) and rides that ended', async () => {
      const a = await login(), b = await login(); await freeRide(a); const idB = await freeRide(b);
      sec(200);                                               // both silent for > the 150 s timeout
      let rides = (await anon().get('/api/live')).body.rides.map((r: { wallet: string }) => r.wallet);
      expect(rides).not.toContain(a.address); expect(rides).not.toContain(b.address);
      const c = await login(), idC = await freeRide(c);
      sec(2); await c.agent.post(`/api/rides/${idC}/end`).send({ outcome: 'failed', s: 0, t: 1 }).expect(200);
      const body = (await anon().get('/api/live')).body;
      rides = body.rides.map((r: { wallet: string }) => r.wallet);
      expect(rides).not.toContain(c.address); void idB;
      // the ended ride moves to the landing's "recent" ticker: status + distance + id (its replay), still no reason
      const rc = body.recent.find((r: { wallet: string }) => r.wallet === c.address);
      expect(rc).toMatchObject({ tier: 'free', status: 'failed', distance: 0 });
      expect(rc.id).toBe(idC); expect(Object.keys(rc)).not.toContain('reason');
      expect(body.upcoming).toEqual([]);   // free rides are never "next up" – only paid, unstarted shifts
      expect(body.totals).toMatchObject({ shifts: expect.any(Number), metres: expect.any(Number), drivers: expect.any(Number) });
    });

    it('a ride whose tab vanished is ENDED by the stale-ride sweep (failed · heartbeat lost): off the live feed, in the recent finishes, a late heartbeat refused', async () => {
      const w = await login(), id = await freeRide(w);
      sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 70, t: 5, hull: 100 }).expect(200);
      sec(160);
      expect(await h().app.get(CommandBus).execute(new SweepStaleRidesCommand())).toEqual({ ended: 1, skipped: 0 });
      expect((await w.agent.get(`/api/rides/${id}`).expect(200)).body).toMatchObject({ status: 'failed', reason: 'heartbeat lost' });
      const feed = (await anon().get('/api/live').expect(200)).body;
      expect(feed.rides.map((r: { id: string }) => r.id)).not.toContain(id);
      expect(feed.recent.find((r: { id: string }) => r.id === id)).toMatchObject({ status: 'failed', distance: 70 });
      await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 80, t: 6, hull: 100 }).expect(409);
      expect((await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body.status).toBe('created');   // the wallet is free for its next ride
    });

    it('who is online: the landing / lobby polls count (a signed-in one as a player), drivers and watchers too; junk presence params never fail the feed', async () => {
      const w = await login(), id = await freeRide(w);
      const fan = await login();
      await anon().get('/api/live').query({ visitor: 'landing-visitor-1', page: 'landing' }).expect(200);
      await fan.agent.get('/api/live').query({ visitor: 'lobby-visitor-01', page: 'lobby' }).expect(200);
      await anon().get(`/api/watch/${id}`).query({ viewer: 'watcher-0000001' }).expect(200);
      const feed = (await anon().get('/api/live').query({ visitor: '<junk>', page: 'nope' }).expect(200)).body;   // junk: not counted, not an error
      expect(feed.online).toEqual({ total: 4, browsing: 2, watching: 1, driving: 1, players: 2 });
      expect(feed.rides.find((r: { id: string }) => r.id === id)).toMatchObject({ viewers: 1, signal: 'live' });
    });

    it('the replays history is public: every ride that ended – a swept one too – newest first, paged, filtered, with its replay flag; a bad cursor is a 400', async () => {
      const a = await login(), b = await login();
      const ids: string[] = [];
      for (const w of [a, b, a]) {
        const id = await freeRide(w); sec(2);
        await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'failed', s: 10, t: 1, reason: 'crashed into a truck' }).expect(200); ids.push(id);
      }
      const gone = await freeRide(b); sec(160); await h().app.get(CommandBus).execute(new SweepStaleRidesCommand());
      const p1 = (await anon().get('/api/replays').query({ limit: 3 }).expect(200)).body;
      expect(p1.rows.map((r: { id: string }) => r.id)).toEqual([gone, ids[2], ids[1]]);
      expect(p1.rows[0]).toMatchObject({ status: 'failed', failCode: 'heartbeat_lost', replay: false });
      expect(p1.rows[1]).toMatchObject({ failCode: 'crash' }); expect(Object.keys(p1.rows[1])).not.toContain('reason');
      const p2 = (await anon().get('/api/replays').query({ limit: 3, before: p1.next }).expect(200)).body;
      expect(p2.rows.map((r: { id: string }) => r.id)).toEqual([ids[0]]); expect(p2.next).toBeNull();
      expect((await anon().get('/api/replays').query({ wallet: a.address }).expect(200)).body.rows.map((r: { id: string }) => r.id)).toEqual([ids[2], ids[0]]);
      await anon().get('/api/replays').query({ before: 'yesterday' }).expect(400);
      await anon().get('/api/replays').query({ status: 'running' }).expect(400);
    });

    it('only whitelisted routes are published; junk is ignored', async () => {
      const w = await login(), id = await freeRide(w);
      sec(2); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 10, t: 2, route: '<img src=x onerror=alert(1)>' }).expect(200);
      expect((await anon().get('/api/live')).body.rides.find((r: { wallet: string }) => r.wallet === w.address).route).toBeNull();
      sec(2); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 20, t: 4, route: 'siberia' }).expect(200);
      sec(2); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 30, t: 6, route: 'nonsense' }).expect(200);   // a bad value keeps the last good one
      expect((await anon().get('/api/live')).body.rides.find((r: { wallet: string }) => r.wallet === w.address).route).toBe('siberia');
    });
  });

  describe('profile and achievements', () => {
    it('requires a session', async () => { await anon().get('/api/profile').expect(401); });

    it('a fresh wallet has stats of zero and every achievement locked', async () => {
      const w = await login(), p = (await w.agent.get('/api/profile').expect(200)).body;
      expect(p).toMatchObject({ wallet: w.address, freeRides: 5, demo: false, stats: { rides: 0, completed: 0, metres: 0 } });
      expect(p.achievements).toHaveLength(7);
      expect(p.achievements.every((a: { earnedAt: number | null }) => a.earnedAt === null)).toBe(true);
      expect(p.achievements.find((a: { id: string }) => a.id === 'top-20').awardedAtRoundClose).toBe(true);
    });

    it('a clean night shift on Siberia unlocks five, persisted with the time; they never disappear', async () => {
      const w = await login(), end = await finish(w, { route: 'siberia', night: true }, 100);
      expect(end.status).toBe('completed');
      const p = (await w.agent.get('/api/profile').expect(200)).body, got = (id: string) => p.achievements.find((a: { id: string }) => a.id === id).earnedAt;
      for (const id of ['first-mile', 'shift-complete', 'night-owl', 'clean-run', 'cold-start']) expect(got(id), id).toBe(now());
      expect(got('century')).toBeNull(); expect(got('top-20')).toBeNull();
      expect(p.stats).toMatchObject({ rides: 1, completed: 1, metres: 150, bestMetres: 150 });
      expect(p.recent[0]).toMatchObject({ tier: 'free', status: 'completed', distance: 150, route: 'siberia' });
      const before = got('night-owl'); sec(3600);
      await finish(w, {}, 60);                                                      // a later, dirty, daytime ride changes nothing already earned
      expect((await w.agent.get('/api/profile')).body.achievements.find((a: { id: string }) => a.id === 'night-owl').earnedAt).toBe(before);
    });

    it('Night Owl needs most of the shift in the dark: night only in the last report does not count', async () => {
      const w = await login(), id = await freeRide(w);
      sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 60, t: 5, hull: 100, night: false }).expect(200);
      sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 120, t: 10, hull: 100, night: false }).expect(200);
      sec(2); await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 150, t: 12, hull: 100, night: true }).expect(200);   // N pressed just before the end
      const got = (p: { achievements: { id: string; earnedAt: number | null }[] }, k: string) => p.achievements.find(a => a.id === k)!.earnedAt;
      let p = (await w.agent.get('/api/profile')).body;
      expect(got(p, 'shift-complete')).not.toBeNull(); expect(got(p, 'night-owl')).toBeNull();
      const w2 = await login(); await finish(w2, { night: true });                          // night for the whole shift
      p = (await w2.agent.get('/api/profile')).body; expect(got(p, 'night-owl')).not.toBeNull();
    });

    it('a failed ride still earns First Mile but not Shift Complete', async () => {
      const w = await login(), id = await freeRide(w);
      sec(2); await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'failed', s: 5, t: 2, hull: 0, reason: 'crash' }).expect(200);
      const a = (await w.agent.get('/api/profile')).body.achievements.filter((x: { earnedAt: number | null }) => x.earnedAt).map((x: { id: string }) => x.id);
      expect(a).toEqual(['first-mile']);
    });

    it('a ride that timed out is caught up when the profile is read', async () => {
      const w = await login(); await freeRide(w); sec(400);
      await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200);          // the stale ride is failed lazily here
      expect((await w.agent.get('/api/profile')).body.achievements.find((a: { id: string }) => a.id === 'first-mile').earnedAt).not.toBeNull();
    });
  });

  describe('buying while holding an unstarted free ride', () => {
    it('cancels the free ride, gives the credit back, and orders the paid one', async () => {
      const w = await login(), free = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      expect((await w.agent.get('/api/me')).body.freeRides).toBe(4);
      const order = (await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
      expect(order).toMatchObject({ tier: '1h', status: 'awaiting_payment' });
      expect((await w.agent.get('/api/me')).body.freeRides).toBe(5);                               // credit refunded exactly once
      expect((await w.agent.get(`/api/rides/${free.id}`)).body).toMatchObject({ status: 'cancelled' });
      await w.agent.post(`/api/rides/${free.id}/start`).expect(409);                               // play.html would be refused too
      expect((await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body.id).toBe(order.id);   // asking again: the same order, no second refund
      expect((await w.agent.get('/api/me')).body.freeRides).toBe(5);
    });

    it('never cancels a PAID unstarted ride: asking for anything else hands it back', async () => {
      const w = await login(), o = (await w.agent.post('/api/rides').send({ tier: '4h' }).expect(200)).body;
      await w.agent.post(`/api/rides/${o.id}/confirm`).send({ signature: h().chain.addPayment({ payer: w.address, lamports: o.lamports, memo: o.id }) }).expect(200);
      for (const tier of ['free', '1h', '4h']) expect((await w.agent.post('/api/rides').send({ tier }).expect(200)).body).toMatchObject({ id: o.id, status: 'created', tier: '4h' });
      expect((await w.agent.get('/api/me')).body.freeRides).toBe(5);
    });
  });

  describe('boards, demo flag', () => {
    it('has a paid all-time board and tells the client the round end and the prize ranks', async () => {
      const { body } = await anon().get('/api/leaderboard?board=all').expect(200);
      expect(body).toMatchObject({ board: 'all', prizeRanks: 20 }); expect(body.round.endsAt).toBeGreaterThan(now());
      expect((await anon().get('/api/leaderboard').expect(200)).body.board).toBe('round');
      const w = await login(); await finish(w);                                    // a finished free ride puts its rider on the free board
      const free = (await anon().get('/api/leaderboard?board=free').expect(200)).body.rows;
      expect(free[0]).toMatchObject({ rank: 1, wallet: w.address, distance: 150, rides: 1 });
    });
  });
}
