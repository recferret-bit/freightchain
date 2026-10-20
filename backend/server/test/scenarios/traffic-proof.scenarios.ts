import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { TrafficSimulator } from '../../src/domain/verdict/traffic-sim.js';
import { encodeTrafficProof } from '../../src/domain/shared/index.js';
import { hashBatch } from '../support/recording.js';
import type { BatchBody } from '../../src/domain/telemetry/ride-batch.entity.js';

export const TRAFFIC_PROOF_ENV = { TRAFFIC_PROOF_REQUIRED: 'true', FREE_RIDE_SECONDS: '10', CHALLENGE_INTERVAL_SECONDS: '0' };
export function trafficProofScenarios(h: () => Harness): void {
  const { login, sec } = bindClient(h);
  beforeEach(() => h().reset());
  it.each(['honest', 'downgrade', 'malformed', 'unbound', 'rehash-without-proof'] as const)('server-stamped frame protocol: %s recording', async (mode) => {
    const who = await login();
    const ride = (await who.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    // A body field the start schema does not declare is a 400, so a client cannot downgrade trafficVersion.
    if (mode === 'downgrade') {
      await who.agent.post(`/api/rides/${ride.id}/start`).send({ trafficVersion: 0 }).expect(400);
      return;
    }
    const started = (await who.agent.post(`/api/rides/${ride.id}/start`).send({}).expect(200)).body;
    expect(started.trafficVersion).toBe(1);
    const sim = new TrafficSimulator(ride.seed, ride.trip, undefined, ride.route), frames: number[][] = [], samples: number[][] = [];
    for (let i = 0; i < 120; i++) {
      const t = i * .05, s = (i + 1) * 1;
      const frame = [.05, t, s, 2.4, 0, 0, 20, 20, 100, 0, 0, 100];
      sim.stepPose(.05, { s, d: 2.4, psi: 0, tyaw: 0, v: 20, vel: 20, hull: 100, rev: false, crashV: 0 }, t + .05, 0, t);
      frame[11] = sim.state.hull; frames.push(frame);
      if (i % 2 === 1) samples.push([Math.round((t + .05) * 100) / 100, s, 2.4, 0, 20, 2000, 5, 100, 1, 0, 0, 0]);
    }
    const body: BatchBody = { seq: 0, prevHash: ride.id, t0: 0, t1: 6, samples, inputs: [[0, 'KeyW', 1], [5900, 'KeyW', 0]], hash: null, trafficProof: encodeTrafficProof(frames) };
    if (mode === 'rehash-without-proof') delete body.trafficProof;
    if (mode === 'malformed') body.trafficProof = 'AAA=';
    if (mode === 'unbound') samples[10]![2] = 2.8;
    body.hash = hashBatch(body);
    sec(10);
    await who.agent.post(`/api/rides/${ride.id}/batches`).send(body).expect(200);
    const end = (await who.agent.post(`/api/rides/${ride.id}/end`).send({ outcome: 'shift', s: 120, t: 6, hull: 100 }).expect(200)).body;
    if (mode === 'honest') expect(end.verdict).toMatchObject({ status: 'verified', reasons: [] });
    else {
      expect(end.verdict.status).toBe('rejected');
      const code = mode === 'unbound' ? 'traffic-proof-mismatch' : mode === 'malformed' ? 'traffic-proof-invalid' : 'traffic-proof-missing';
      expect(end.verdict.reasons).toContainEqual(expect.objectContaining({ code, severity: 'reject' }));
      expect(end.verdict.reasons.some((r: { code: string }) => r.code === 'hash-mismatch')).toBe(false);
    }
    const replay = (await who.agent.get(`/api/rides/${ride.id}/replays`).expect(200)).body.replays[0];
    expect(replay.status).toBe(end.verdict.status);
    expect(replay.rulesVersion).toBeGreaterThanOrEqual(7);
  });
}
