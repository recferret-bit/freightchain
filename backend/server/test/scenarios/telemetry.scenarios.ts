import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { recording, upload } from '../support/recording.js';

/* The game uploads its recording in hash-chained batches while the ride runs (and flushes the last one right after /end). Same scenarios on in-memory and PostgreSQL. */
export const TELEMETRY_ENV = { FREE_RIDE_SECONDS: '10' };

export function telemetryScenarios(h: () => Harness): void {
  const { anon, login, sec } = bindClient(h);
  beforeEach(() => h().reset());

  const startedRide = async () => {
    const w = await login();
    const ride = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await w.agent.post(`/api/rides/${ride.id}/start`).expect(200);
    return { w, ride };
  };

  it('refuses unsafe road work before storing the batch; the same sequence can then accept a valid recording', async () => {
    const { w, ride } = await startedRide();
    const [valid] = recording(ride.id, { seconds: 10 });
    for (const distance of [1e12, 1e7, -1e7]) {
      const samples = valid!.samples.map((row) => [...row]);
      samples[1]![1] = distance;
      const res = await w.agent.post(`/api/rides/${ride.id}/batches`).send({ ...valid, samples }).expect(400);
      expect(res.body.code).toBe('bad_batch');
    }
    const res = await w.agent.post(`/api/rides/${ride.id}/batches`).send(valid).expect(200);
    expect(res.body).toMatchObject({ seq: 0, stored: true, hashOk: true });
  });

  it('stores a chained recording during the ride; a re-sent batch is stored:false; a wrong hash is kept but not trusted', async () => {
    const { w, ride } = await startedRide();
    const batches = recording(ride.id, { seconds: 30 });
    expect(await upload(w.agent, ride.id, batches)).toEqual([{ seq: 0, stored: true, hashOk: true }, { seq: 1, stored: true, hashOk: true }]);
    expect((await w.agent.post(`/api/rides/${ride.id}/batches`).send(batches[0]).expect(200)).body).toMatchObject({ seq: 0, stored: false });
    expect((await w.agent.post(`/api/rides/${ride.id}/batches`).send({ ...batches[1], seq: 2, hash: 'b'.repeat(64) }).expect(200)).body).toEqual({ seq: 2, stored: true, hashOk: false });
    expect((await w.agent.post(`/api/rides/${ride.id}/batches`).send({ ...batches[1], seq: 3, hash: null }).expect(200)).body).toEqual({ seq: 3, stored: true, hashOk: false });
  });

  it('takes the final flush for a minute after the end, then 409; a ride that never started is 409 too', async () => {
    const { w, ride } = await startedRide();
    const batches = recording(ride.id, { seconds: 10 });
    sec(10);
    await w.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'shift', s: 140, t: 10 }).expect(200);
    sec(59);
    await w.agent.post(`/api/rides/${ride.id}/batches`).send(batches[0]).expect(200);
    sec(2);
    const late = await w.agent.post(`/api/rides/${ride.id}/batches`).send({ ...batches[0], seq: 1 }).expect(409);
    expect(late.body).toMatchObject({ status: 409, detail: 'ride is completed' });
    const fresh = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    await w.agent.post(`/api/rides/${fresh.id}/batches`).send(recording(fresh.id, { seconds: 10 })[0]).expect(409);
  });

  it('is private and strict: no session 401, another wallet 404, garbage 400 with the field named', async () => {
    const { ride } = await startedRide();
    const [b0] = recording(ride.id, { seconds: 10 });
    await anon().post(`/api/rides/${ride.id}/batches`).send(b0).expect(401);
    const other = await login();
    await other.agent.post(`/api/rides/${ride.id}/batches`).send(b0).expect(404);
    const { w: owner, ride: mine } = await startedRide();
    for (const bad of [{ ...b0, seq: -1 }, { ...b0, hash: 'nope' }, { ...b0, inputs: [[1, 'KeyW', 2]] }, { ...b0, samples: 'x' }, { ...b0, t1: 1e9 }]) {
      const res = await owner.agent.post(`/api/rides/${mine.id}/batches`).send(bad).expect(400);
      expect(res.body.errors?.length ?? 0).toBeGreaterThan(0);
    }
    expect((await owner.agent.post(`/api/rides/${mine.id}/batches`).send({ ...b0, t0: 5, t1: 1 }).expect(400)).body.code).toBe('bad_batch');
  });
}
