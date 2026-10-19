import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { RideBatch } from '../../../../src/domain/telemetry/ride-batch.entity.js';
import { encodeTrafficProof } from '../../../../src/domain/shared/index.js';
import { TrafficSimulator } from '../../../../src/domain/verdict/traffic-sim.js';
import { verifyTrafficProof } from '../../../../src/domain/verdict/traffic-proof.js';
import { hashBatch } from '../../../support/recording.js';
const now = new Date('2026-10-15T00:00:00Z');
const ride = Ride.createFree({ id: 'proof-ride', wallet: 'wallet', seed: 42, minSeconds: 3, now });
ride.start(now, null, 1);
const batch = (frames: number[][], samples: number[][] = []) => {
  const body = { seq: 0, prevHash: ride.id, t0: 0, t1: .1, samples, inputs: [], trafficProof: encodeTrafficProof(frames), hash: null };
  return RideBatch.accept(ride.id, body, hashBatch(body), now);
};
const frame = () => [.05, 0, 0, 2.4, 0, 0, 0, 0, 100, 0, 0, 100];
describe('required traffic frame proof', () => {
  it.each([NaN, Infinity, 1e12])('refuses unsafe frame coordinates (%s) before road geometry or traffic stepping', (s) => {
    const sim = new TrafficSimulator(42, ride.trip), spy = vi.spyOn(sim, 'stepPose');
    const f = frame(); f[2] = s;
    expect(verifyTrafficProof(ride, [batch([f])], sim)[0]?.code).toBe('traffic-proof-invalid');
    expect(spy).not.toHaveBeenCalled();
  });
  it('a frame clock gap cannot skip a collision interval', () => {
    const f = frame(), g = frame(); g[1] = .06;
    expect(verifyTrafficProof(ride, [batch([f, g])], new TrafficSimulator(42, ride.trip))[0]?.code).toBe('traffic-proof-invalid');
  });
  it('an empty, well-hashed proof does not prove that traffic was simulated', () => {
    expect(verifyTrafficProof(ride, [batch([])], new TrafficSimulator(42, ride.trip))[0]?.code).toBe('traffic-proof-missing');
  });
  it('includes the proof in the canonical hash while retaining historical canonical bytes without one', () => {
    const saved = batch([frame()]).body;
    expect(RideBatch.canonical(saved)).toContain('"trafficProof"');
    const { trafficProof: _proof, ...legacy } = saved;
    expect(RideBatch.canonical(legacy)).toBe(JSON.stringify({ seq: legacy.seq, prevHash: legacy.prevHash, t0: legacy.t0, t1: legacy.t1, samples: legacy.samples, inputs: legacy.inputs }));
    expect(hashBatch(saved)).not.toBe(hashBatch(legacy));
  });
});
