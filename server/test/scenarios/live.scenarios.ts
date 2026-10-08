import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { recording, upload } from '../support/recording.js';

/* Live streams: anyone watches (the replay of the recording + the feed), a signed-in spectator writes / donates (mock), the driver's game reads its inbox and
   stamps the effects it applied. Same scenarios on in-memory and PostgreSQL. */
export const LIVE_ENV = { FREE_RIDE_SECONDS: '10' };

export function liveScenarios(h: () => Harness): void {
  const { anon, login, sec } = bindClient(h);
  beforeEach(() => h().reset());

  const onTheRoad = async () => {
    const driver = await login();
    const ride = (await driver.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await driver.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    return { driver, ride };
  };

  it('anyone can watch a started ride from the public live feed: seed + route for the road, the recording as samples only, paged by seq', async () => {
    const { driver, ride } = await onTheRoad();
    const batches = recording(ride.id, { seconds: 30 });
    sec(30); await upload(driver.agent, ride.id, batches);
    await driver.agent.post(`/api/rides/${ride.id}/heartbeat`).send({ s: 140, t: 30, hull: 100, route: 'stuart', night: false }).expect(200);
    const live = (await anon().get('/api/live').expect(200)).body.rides[0];
    expect(live.id).toBe(ride.id);
    const { body } = await anon().get(`/api/watch/${live.id}`).query({ viewer: 'v-1' }).expect(200);
    expect(body.ride).toMatchObject({ id: ride.id, wallet: driver.address, seed: ride.seed, route: 'stuart', status: 'running', live: true });
    expect(body.recording).toEqual({ lastSeq: 1, t1: batches[1]!.t1 });
    expect(body.batches.map((b: { seq: number }) => b.seq)).toEqual([0, 1]);
    expect(body.batches[0].samples).toEqual(batches[0]!.samples);
    expect(Object.keys(body.batches[0])).not.toContain('inputs');
    expect(Object.keys(body.ride)).not.toContain('reason');
    expect(body.viewers).toBe(1);
    expect((await anon().get(`/api/watch/${ride.id}`).query({ from: 1 }).expect(200)).body.batches.map((b: { seq: number }) => b.seq)).toEqual([1]);
    await anon().get('/api/watch/no-such-ride').expect(404);
    const unstarted = await login();
    const fresh = (await unstarted.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await anon().get(`/api/watch/${fresh.id}`).expect(404); // no seed before the start
    expect((await anon().get(`/api/watch/${ride.id}`).query({ from: -1 }).expect(400)).body.status).toBe(400);
    await anon().get(`/api/watch/${ride.id}`).query({ viewer: '<script>' }).expect(400);
  });

  it('a signed-in spectator writes and donates; the driver reads it in its inbox, stamps the obstacle it placed, and every watcher sees where', async () => {
    const { driver, ride } = await onTheRoad();
    const fan = await login();
    const line = (await fan.agent.post(`/api/watch/${ride.id}/messages`).send({ text: ' keep on\ntrucking ' }).expect(200)).body;
    expect(line).toMatchObject({ kind: 'message', wallet: fan.address, text: 'keep on trucking', applied: null });
    const hole = (await fan.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: 'sinkhole', note: 'surprise' }).expect(200)).body;
    expect(hole).toMatchObject({ kind: 'donation', effect: 'sinkhole', text: 'surprise', lamports: 50_000_000 });

    const inbox = (await driver.agent.get(`/api/rides/${ride.id}/inbox`).query({ after: 0 }).expect(200)).body;
    expect(inbox.events.map((e: { id: number }) => e.id)).toEqual([line.id, hole.id]);
    expect(inbox.totals).toEqual({ messages: 1, donations: 1, lamports: 50_000_000 });
    expect((await driver.agent.get(`/api/rides/${ride.id}/inbox`).query({ after: line.id }).expect(200)).body.events).toHaveLength(1);

    const stamped = (await driver.agent.post(`/api/rides/${ride.id}/effects/${hole.id}/applied`).send({ t: 4.2, s: 1210, lat: 2.4 }).expect(200)).body;
    expect(stamped.applied).toEqual({ t: 4.2, s: 1210, lat: 2.4, placed: true });
    const watched = (await anon().get(`/api/watch/${ride.id}`).query({ after: line.id }).expect(200)).body;
    expect(watched.events).toEqual([stamped]);
    expect(watched.totals.donations).toBe(1);
  });

  it('the rules: no session 401, your own ride 403, junk 400, one effect per window 429, a ride that ended 409; the inbox and the stamp are the owner’s', async () => {
    const { driver, ride } = await onTheRoad();
    const fan = await login(), other = await login();
    await anon().post(`/api/watch/${ride.id}/messages`).send({ text: 'hi' }).expect(401);
    await anon().get(`/api/rides/${ride.id}/inbox`).expect(401);
    expect((await driver.agent.post(`/api/watch/${ride.id}/messages`).send({ text: 'me' }).expect(403)).body.code).toBe('own_ride');
    for (const bad of [{}, { text: '' }, { text: 'x'.repeat(1000) }, { text: 5 }]) await fan.agent.post(`/api/watch/${ride.id}/messages`).send(bad).expect(400);
    expect((await fan.agent.post(`/api/watch/${ride.id}/messages`).send({ text: '\n \t' }).expect(400)).body.code).toBe('bad_message');
    await fan.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: 'meteor' }).expect(400);
    const night = (await fan.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: 'night' }).expect(200)).body;
    const busy = await other.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: 'trench' }).expect(429);
    expect(busy.body).toMatchObject({ status: 429, code: 'live_rate_limited' });
    await other.agent.get(`/api/rides/${ride.id}/inbox`).expect(404);
    await other.agent.post(`/api/rides/${ride.id}/effects/${night.id}/applied`).send({ t: 1, s: 1 }).expect(404);
    await driver.agent.post(`/api/rides/${ride.id}/effects/${night.id}/applied`).send({ t: -1, s: 1 }).expect(400);
    sec(2); await driver.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'failed', s: 10, t: 2 }).expect(200);
    expect((await fan.agent.post(`/api/watch/${ride.id}/messages`).send({ text: 'too late' }).expect(409)).body.code).toBe('ride_not_live');
    await driver.agent.post(`/api/rides/${ride.id}/effects/${night.id}/applied`).send({ t: 1, s: 1 }).expect(409);
    const replay = (await anon().get(`/api/watch/${ride.id}`).expect(200)).body; // an ended ride stays watchable: the replay + its feed
    expect(replay).toMatchObject({ ride: { live: false, status: 'failed' }, viewers: 0, recording: { lastSeq: null } });
    expect(replay.events).toHaveLength(1);
  });
}
