import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { INPUT_BIT, recording, upload } from '../support/recording.js';
import { SAMPLE_INPUT_COL } from '../../src/domain/telemetry/telemetry-rules.js';
import { TREASURY } from '../support/fake-chain.js';
import { setTierOnSaleForTest } from '../../src/domain/rides/ride-tier.js';

/* Live streams: anyone watches (the replay of the recording + the feed), a signed-in spectator writes / donates (mock), the driver's game reads its inbox and
   stamps the effects it applied. Same scenarios on in-memory and PostgreSQL. */
export const LIVE_ENV = { FREE_RIDE_SECONDS: '10' };

export function liveScenarios(h: () => Harness): void {
  const { anon, login, sec } = bindClient(h);
  beforeEach(() => { setTierOnSaleForTest('1h', true); return h().reset(); });
  afterEach(() => setTierOnSaleForTest('1h', false));

  const onTheRoad = async () => {
    const driver = await login();
    const ride = (await driver.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    const sig = h().chain.addPayment({ payer: driver.address, destination: TREASURY, lamports: ride.lamports, memo: ride.id });
    await driver.agent.post(`/api/rides/${ride.id}/confirm`).send({ signature: sig }).expect(200);
    await driver.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    return { driver, ride };
  };
  const end = async (driver: { agent: { post: (p: string) => { send: (b?: object) => { expect: (n: number) => Promise<unknown> } } } }, id: string) => {
    await driver.agent.post(`/api/rides/${id}/end`).send({ outcome: 'failed', s: 20, t: 2 }).expect(200);
  };

  it('a closing watch page (leave=1) stops counting at once – a replay, not a ride that is still running', async () => {
    const { driver, ride } = await onTheRoad();
    expect((await anon().get(`/api/watch/${ride.id}`).expect(404)).body.code).toBe('replay_not_available');
    await end(driver, ride.id);
    expect((await anon().get('/api/live').expect(200)).body.rides).toEqual([]);
    expect((await anon().get(`/api/watch/${ride.id}`).query({ viewer: 'closing-viewer' }).expect(200)).body.viewers).toBe(1);
    expect((await anon().get(`/api/watch/${ride.id}`).query({ viewer: 'closing-viewer', leave: '1' }).expect(200)).body.viewers).toBe(0);
    expect((await anon().get('/api/live').expect(200)).body.online.watching).toBe(0);
  });

  it('anyone can watch a started ride from the public live feed: seed + route for the road, the recording as samples only, paged by seq', async () => {
    h().seedFor('stuart');
    const { driver, ride } = await onTheRoad();
    const batches = recording(ride.id, { seconds: 30 });
    sec(30); await upload(driver.agent, ride.id, batches);
    await driver.agent.post(`/api/rides/${ride.id}/heartbeat`).send({ s: 140, t: 30, hull: 100, night: false }).expect(200);
    expect((await anon().get('/api/live').expect(200)).body.rides).toEqual([]);
    expect((await anon().get(`/api/watch/${ride.id}`).expect(404)).body.code).toBe('replay_not_available');
    await end(driver, ride.id);
    const { body } = await anon().get(`/api/watch/${ride.id}`).query({ viewer: 'v-1' }).expect(200);
    expect(body.ride).toMatchObject({ id: ride.id, wallet: driver.address, seed: ride.seed, trip: '1h', level: null, route: 'stuart', status: 'failed', live: false });   // trip: the road the replay rebuilds (client/js/trips.js)
    expect(body.recording).toEqual({ lastSeq: 1, t1: batches[1]!.t1 });
    expect(body.batches.map((b: { seq: number }) => b.seq)).toEqual([0, 1]);
    expect(body.batches[0].samples).toEqual(batches[0]!.samples);
    expect(Object.keys(body.batches[0])).not.toContain('inputs');
    expect(Object.keys(body.ride)).not.toContain('reason');
    expect(body.viewers).toBe(1);
    expect((await anon().get(`/api/watch/${ride.id}`).query({ from: 1 }).expect(200)).body.batches.map((b: { seq: number }) => b.seq)).toEqual([1]);
    await anon().get('/api/watch/no-such-ride').expect(404);
    const unstarted = await login();
    const fresh = (await unstarted.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    await anon().get(`/api/watch/${fresh.id}`).expect(404); // no seed before the start
    expect((await anon().get(`/api/watch/${ride.id}`).query({ from: -1 }).expect(400)).body.status).toBe(400);
    await anon().get(`/api/watch/${ride.id}`).query({ viewer: '<script>' }).expect(400);
  });

  it('free rides: stream watching and live interactions are refused with 403 free_ride_no_stream; replay works once ended', async () => {
    const driver = await login();
    const free = (await driver.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await driver.agent.post(`/api/rides/${free.id}/start`).expect(200);
    sec(2); await driver.agent.post(`/api/rides/${free.id}/heartbeat`).send({ s: 50, t: 2, hull: 100 }).expect(200);

    // does not appear in live feed
    const liveRides = (await anon().get('/api/live').expect(200)).body.rides;
    expect(liveRides.find((r: { id: string }) => r.id === free.id)).toBeUndefined();

    // cannot watch live on /api/watch/:id
    const err = await anon().get(`/api/watch/${free.id}`).expect(404);
    expect(err.body).toMatchObject({ status: 404, code: 'replay_not_available' });
    await anon().get(`/api/watch/${free.id}/road`).query({ from: 0, to: 6000 }).expect(404);

    const fan = await login();
    await fan.agent.post(`/api/watch/${free.id}/messages`).send({ text: 'cheers' }).expect(403);
    await fan.agent.post(`/api/watch/${free.id}/donations`).send({ effect: 'tip' }).expect(404);

    sec(5); await driver.agent.post(`/api/rides/${free.id}/end`).send({ outcome: 'shift', s: 20, t: 7, hull: 100 }).expect(200);
    expect((await anon().get(`/api/watch/${free.id}`).expect(404)).body.code).toBe('replay_not_available');
  });

  it('the ride\'s obstacle plan is public once it started – the holes the server rebuilt from the seed; every watched batch says what the truck did at them', async () => {
    const { driver, ride } = await onTheRoad();
    await anon().get(`/api/watch/${ride.id}/road`).query({ from: 0, to: 6000 }).expect(404);
    await end(driver, ride.id);
    const plan = (await anon().get(`/api/watch/${ride.id}/road`).query({ from: 0, to: 6000 }).expect(200)).body;
    expect(plan).toMatchObject({ rideId: ride.id, seed: ride.seed, from: 0, to: 6016, chunk: 32 });
    expect(plan.holes.length).toBeGreaterThan(0);
    expect(plan.holes.every((x: { type: string; ci: number; id: string }) => x.type === 'sinkhole' && x.id === `h${x.ci}`)).toBe(true);
    expect((await driver.agent.get(`/api/watch/${ride.id}/road`).query({ from: 0, to: 6000 }).expect(200)).body).toEqual(plan); // the driver's game gets the same
    await anon().get(`/api/watch/${ride.id}/road`).query({ from: 0, to: 20_000 }).expect(400); // a window of at most 10 km
    await anon().get(`/api/watch/${ride.id}/road`).query({ from: 500, to: 100 }).expect(400);
    const unstarted = await login();
    const fresh = (await unstarted.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    await anon().get(`/api/watch/${fresh.id}/road`).query({ from: 0, to: 6000 }).expect(404); // no road before the start
    const own = plan.holes.find((x: { lat: number }) => Math.abs(x.lat - 2.4) < 0.01);
    const distance = Math.ceil(own.s + 40), seconds = Math.ceil(distance / 20);
    sec(seconds);
    await upload(driver.agent, ride.id, recording(ride.id, { seconds, distance })); // hull 100 throughout: the hole was not in this game
    const road = (await anon().get(`/api/watch/${ride.id}`).expect(200)).body.batches.flatMap((b: { road?: unknown[] }) => b.road ?? []);
    expect(road).toContainEqual(expect.objectContaining({ hole: own.id, outcome: 'ignored', got: 0 }));
  });

  it('the replays\' traffic track: uploaded beside a batch (outside its hash), served back with it; a malformed one is dropped – the batch is still taken', async () => {
    const { driver, ride } = await onTheRoad();
    const [b0, b1] = recording(ride.id, { seconds: 30 });
    sec(30);
    const traffic = [[0.5, 3, 1, 4, 120.5, -10, 1.571, 1]];
    expect((await driver.agent.post(`/api/rides/${ride.id}/batches`).send({ ...b0, traffic }).expect(200)).body).toMatchObject({ stored: true, hashOk: true });
    expect((await driver.agent.post(`/api/rides/${ride.id}/batches`).send({ ...b1, traffic: 'garbage' }).expect(200)).body).toMatchObject({ stored: true, hashOk: true });
    await end(driver, ride.id);
    const { batches } = (await anon().get(`/api/watch/${ride.id}`).expect(200)).body;
    expect(batches[0].traffic).toEqual(traffic);
    expect(Object.keys(batches[1])).not.toContain('traffic');
  });

  it('the replays\' input column: the controls per sample travel in the hashed recording (a 15-column row) and come back to every watcher as uploaded – the raw input events never do', async () => {
    const { driver, ride } = await onTheRoad();
    const batches = recording(ride.id, { seconds: 30, replay: true });
    sec(30);
    expect((await upload(driver.agent, ride.id, batches)).every((r) => r.stored && r.hashOk)).toBe(true);
    await end(driver, ride.id);
    const { body } = await anon().get(`/api/watch/${ride.id}`).expect(200);
    const served = (body.batches as { samples: number[][] }[]).flatMap((b) => b.samples);
    expect(served.every((r) => r.length === SAMPLE_INPUT_COL + 1 && r[SAMPLE_INPUT_COL] === 0)).toBe(true);
    expect(served.some((r) => r[SAMPLE_INPUT_COL]! & INPUT_BIT.gas)).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/KeyW|ShiftLeft/);
    const sent = (await anon().get(`/api/watch/${ride.id}`).query({ from: 1 }).expect(200)).body.batches[0].samples as number[][];
    expect(sent.every((r) => r[SAMPLE_INPUT_COL] === 0)).toBe(true);
  });

  it('a signed-in spectator writes and donates; the driver reads it in its inbox, stamps the obstacle it placed, and every watcher sees where', async () => {
    const { driver, ride } = await onTheRoad();
    const fan = await login();
    const line = (await fan.agent.post(`/api/watch/${ride.id}/messages`).send({ text: ' keep on\ntrucking ' }).expect(200)).body;
    expect(line).toMatchObject({ kind: 'message', wallet: fan.address, text: 'keep on trucking', applied: null });
    expect((await fan.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: 'sinkhole', note: 'surprise' }).expect(400)).body.code).toBe('donation_effect');
    await end(driver, ride.id);
    const hole = (await fan.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: 'tip', note: 'surprise' }).expect(200)).body;
    expect(hole).toMatchObject({ kind: 'donation', effect: 'tip', text: 'surprise', lamports: 10_000_000 });

    const inbox = (await driver.agent.get(`/api/rides/${ride.id}/inbox`).query({ after: 0 }).expect(200)).body;
    expect(inbox.events.map((e: { id: number }) => e.id)).toEqual([line.id, hole.id]);
    expect(inbox.totals).toEqual({ messages: 1, donations: 1, lamports: 10_000_000 });
    expect((await driver.agent.get(`/api/rides/${ride.id}/inbox`).query({ after: line.id }).expect(200)).body.events).toHaveLength(1);

    await driver.agent.post(`/api/rides/${ride.id}/effects/${hole.id}/applied`).send({ t: 4.2, s: 1210, lat: 2.4 }).expect(404);
    const watched = (await anon().get(`/api/watch/${ride.id}`).query({ after: line.id }).expect(200)).body;
    expect(watched.events).toEqual([hole]);
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
    expect((await fan.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: 'night' }).expect(400)).body.code).toBe('donation_effect');
    await other.agent.get(`/api/rides/${ride.id}/inbox`).expect(404);
    await driver.agent.post(`/api/rides/${ride.id}/effects/1/applied`).send({ t: 1, s: 1 }).expect(404);
    await driver.agent.post(`/api/rides/${ride.id}/effects/1/applied`).send({ t: -1, s: 1 }).expect(400);
    sec(2); await driver.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'failed', s: 10, t: 2 }).expect(200);
    expect((await fan.agent.post(`/api/watch/${ride.id}/messages`).send({ text: 'too late' }).expect(200)).body).toMatchObject({ kind: 'message', text: 'too late', replayT: 0 });
    const replay = (await anon().get(`/api/watch/${ride.id}`).expect(200)).body;
    expect(replay).toMatchObject({ ride: { live: false, status: 'failed' }, recording: { lastSeq: null } });
  });

  it('the driver mutes a spectator: their lines vanish from the watch page and the inbox, they cannot post there; unmute lets them back', async () => {
    const { driver, ride } = await onTheRoad();
    const troll = await login(), fan = await login();
    await troll.agent.post(`/api/watch/${ride.id}/messages`).send({ text: 'boo' }).expect(200);
    await fan.agent.post(`/api/watch/${ride.id}/messages`).send({ text: 'go go' }).expect(200);
    expect((await driver.agent.post(`/api/rides/${ride.id}/mutes`).send({ wallet: troll.address, muted: true }).expect(200)).body).toEqual({ wallet: troll.address, muted: true });
    const texts = (b: { events: { text: string }[] }) => b.events.map((e) => e.text);
    expect(texts((await driver.agent.get(`/api/rides/${ride.id}/inbox`).expect(200)).body)).toEqual(['go go']);
    const inbox = (await driver.agent.get(`/api/rides/${ride.id}/inbox`).expect(200)).body;
    expect(texts(inbox)).toEqual(['go go']); expect(inbox.muted).toEqual([troll.address]);
    sec(4);
    expect((await troll.agent.post(`/api/watch/${ride.id}/messages`).send({ text: 'again' }).expect(403)).body.code).toBe('muted');
    await fan.agent.post(`/api/rides/${ride.id}/mutes`).send({ wallet: troll.address, muted: false }).expect(404); // not the driver
    await driver.agent.post(`/api/rides/${ride.id}/mutes`).send({ wallet: 'not-a-wallet', muted: true }).expect(400);
    await driver.agent.post(`/api/rides/${ride.id}/mutes`).send({ wallet: troll.address, muted: false }).expect(200);
    await troll.agent.post(`/api/watch/${ride.id}/messages`).send({ text: 'sorry' }).expect(200);
  });

  it('every view carries the ride\'s features (the default flags: everything on, mock donations)', async () => {
    const { driver, ride } = await onTheRoad();
    const all = { chat: true, donations: true, payment: 'mock', effects: false };
    expect((await driver.agent.get(`/api/rides/${ride.id}/inbox`).expect(200)).body.features).toEqual(all);
    await end(driver, ride.id);
    expect((await anon().get(`/api/watch/${ride.id}`).expect(200)).body.features).toEqual(all);
  });
}

/* The LIVE_* feature flags as production runs them by default (deploy/docker-compose.prod.yml): chat everywhere, effects only on free test rides,
   donations paid on chain (no free mock) – here with chat on free rides only, to see every refusal. */
export const LIVE_FLAGS_ENV = { FREE_RIDE_SECONDS: '10', LIVE_CHAT: 'all', LIVE_EFFECTS: 'all', LIVE_FREE_DONATIONS: 'off' };
export const LIVE_OFF_ENV = { FREE_RIDE_SECONDS: '10', LIVE_CHAT: 'off', LIVE_DONATIONS: 'off' };

export function liveFlagsScenarios(h: () => Harness): void {
  const { anon, login, sec } = bindClient(h);
  beforeEach(() => { setTierOnSaleForTest('1h', true); return h().reset(); });
  afterEach(() => setTierOnSaleForTest('1h', false));

  const onTheRoad = async () => {
    const driver = await login();
    const ride = (await driver.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    const sig = h().chain.addPayment({ payer: driver.address, destination: TREASURY, lamports: ride.lamports, memo: ride.id });
    await driver.agent.post(`/api/rides/${ride.id}/confirm`).send({ signature: sig }).expect(200);
    await driver.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    return { driver, ride };
  };

  it('paid shifts: chat and effects allowed, donations need a real transfer (payment chain); the flags reach the watch page', async () => {
    const { driver, ride } = await onTheRoad();
    const fan = await login();
    await fan.agent.post(`/api/watch/${ride.id}/messages`).send({ text: 'hi' }).expect(200);
    await driver.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'failed', s: 10, t: 2 }).expect(200);
    expect((await anon().get(`/api/watch/${ride.id}`).expect(200)).body.features).toEqual({ chat: true, donations: true, payment: 'chain', effects: false });
  });

  it('a PAID donation: order → the spectator\'s transfer to the driver (memo) → confirm → it enters the feed; nothing before; the free route refuses', async () => {
    const { driver, ride } = await onTheRoad();
    const fan = await login();
    await driver.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'failed', s: 10, t: 2 }).expect(200);
    expect((await fan.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: 'tip' }).expect(403)).body.code).toBe('payment_required');
    expect((await fan.agent.post(`/api/watch/${ride.id}/donation-orders`).send({ effect: 'night', note: 'lights' }).expect(400)).body.code).toBe('donation_effect');
    const { order, transaction } = (await fan.agent.post(`/api/watch/${ride.id}/donation-orders`).send({ effect: 'tip', note: 'lights' }).expect(200)).body;
    const treasuryCut = Math.floor(order.lamports * 500 / 10_000);
    expect(order).toMatchObject({ effect: 'tip', lamports: 10_000_000, to: driver.address, memo: `fc-donation:${order.id}` });
    expect(typeof transaction.transaction).toBe('string');
    expect((await anon().get(`/api/watch/${ride.id}`).expect(200)).body.events).toEqual([]);   // nothing until paid
    const confirm = (signature: string) => fan.agent.post(`/api/watch/${ride.id}/donation-orders/${order.id}/confirm`).send({ signature });
    const sig = h().chain.addPayment({ payer: fan.address, destination: driver.address, lamports: order.lamports - treasuryCut, memo: order.memo, reference: order.reference, extraTransfers: [{ source: fan.address, destination: TREASURY, lamports: treasuryCut }] });
    expect((await confirm('5'.repeat(88)).expect(200)).body).toEqual({ status: 'pending' });
    const paid = (await confirm(sig).expect(200)).body;
    expect(paid).toMatchObject({ status: 'paid', event: { effect: 'tip', signature: sig, lamports: 10_000_000, text: 'lights' } });
    const feed = (await anon().get(`/api/watch/${ride.id}`).expect(200)).body;
    expect(feed.events.map((e: { id: number }) => e.id)).toEqual([paid.event.id]);
    expect(feed.totals).toMatchObject({ donations: 1, lamports: 10_000_000 });
    const inbox = (await driver.agent.get(`/api/rides/${ride.id}/inbox`).expect(200)).body;
    expect(inbox.events[0]).toMatchObject({ effect: 'tip', applied: null });
    expect((await confirm(sig).expect(200)).body).toEqual(paid);
    sec(1);
    const other = (await fan.agent.post(`/api/watch/${ride.id}/donation-orders`).send({ effect: 'tip' }).expect(200)).body.order;
    expect((await fan.agent.post(`/api/watch/${ride.id}/donation-orders/${other.id}/confirm`).send({ signature: sig }).expect(409)).body.code).toBe('signature_reused');
    const wrong = h().chain.addPayment({ payer: fan.address, lamports: other.lamports, memo: other.memo, reference: other.reference });   // to the treasury, not the driver
    expect((await fan.agent.post(`/api/watch/${ride.id}/donation-orders/${other.id}/confirm`).send({ signature: wrong }).expect(400)).body.detail).toBe('no transfer of the donation from your wallet to the driver');
  });
}

export function liveOffScenarios(h: () => Harness): void {
  const { anon, login } = bindClient(h);
  beforeEach(() => { setTierOnSaleForTest('1h', true); return h().reset(); });
  afterEach(() => setTierOnSaleForTest('1h', false));

  const onTheRoad = async () => {
    const driver = await login();
    const ride = (await driver.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    const sig = h().chain.addPayment({ payer: driver.address, destination: TREASURY, lamports: ride.lamports, memo: ride.id });
    await driver.agent.post(`/api/rides/${ride.id}/confirm`).send({ signature: sig }).expect(200);
    await driver.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    return { driver, ride };
  };

  it('chat and donations switched off: every post is a 403 live_feature_off, watching still works', async () => {
    const { driver, ride } = await onTheRoad();
    const fan = await login();
    expect((await fan.agent.post(`/api/watch/${ride.id}/messages`).send({ text: 'hi' }).expect(403)).body).toMatchObject({ code: 'live_feature_off', detail: 'chat is off on this ride' });
    await driver.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'failed', s: 10, t: 2 }).expect(200);
    expect((await fan.agent.post(`/api/watch/${ride.id}/donations`).send({ effect: 'tip' }).expect(403)).body.detail).toBe('donations are off');
    expect((await anon().get(`/api/watch/${ride.id}`).expect(200)).body.features).toEqual({ chat: false, donations: false, payment: 'mock', effects: false });
  });
}
