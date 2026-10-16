import type { Ride } from '../rides/ride.entity.js';
import type { RideBatch } from '../telemetry/ride-batch.entity.js';
import { decodeTrafficProof } from '../shared/index.js';
import type { ReplayRedFlag } from './ride-replay.entity.js';
import type { TrafficSimulator } from './traffic-sim.js';

/** Uses the browser's lossless pre-contact frames, never its display-only car track.
 * Every sampled pose must match a simulated post-contact frame. Missing evidence cannot downgrade a server-stamped ride. */
export function verifyTrafficProof(ride: Ride, batches: readonly RideBatch[], sim: TrafficSimulator): ReplayRedFlag[] {
  let clock = 0, previousS = 0, lastHull = 100, frames = 0;
  const fail = (code: string, detail: string, t: number | null = null, s: number | null = null): ReplayRedFlag[] =>
    [{ code, detail, category: 'traffic', severity: 'reject', atSecond: t, atMetre: s, evidence: { frames, protocol: ride.trafficVersion } }];
  const posts = new Map<number, number[][]>();
  for (const batch of batches) {
    if (batch.body.trafficProof === undefined) return fail('traffic-proof-missing', 'required traffic frame evidence is absent');
    const rows = decodeTrafficProof(batch.body.trafficProof);
    if (!rows) return fail('traffic-proof-invalid', 'traffic frame encoding is invalid');
    posts.clear();
    for (const row of rows) {
      const [dt, time, s, d, psi, tyaw, v, vel, hull, rev, branch, after] = row as [number, number, number, number, number, number, number, number, number, number, number, number];
      if (!row.every(Number.isFinite) || !(dt > 0 && dt <= .050001) || Math.abs(time - clock) > 1e-7
        || time + dt > batch.t1 + .051 || time < batch.t0 - .051 || Math.abs(s) > 1000 + 56 * (time + dt)
        || Math.abs(s - previousS) > 20 + 56 * dt || Math.abs(d) > 100 || Math.abs(psi) > 1e5 || Math.abs(tyaw) > 1e5
        || v < 0 || v > 29 || Math.abs(vel) > 29 || hull < 0 || hull > lastHull + .001 || after < 0 || after > hull + .001
        || (rev !== 0 && rev !== 1) || (branch !== 0 && branch !== 1)) return fail('traffic-proof-invalid', 'traffic frame bounds or continuity failed', clock, previousS);
      const fork = sim.net.forkAt(s);
      if (fork && sim.net.setChoice(fork, branch)) sim.clearStretch(fork.f0, fork.f1);
      const fatal = sim.stepPose(dt, { s, d, psi, tyaw, v, vel, hull, rev: rev === 1, crashV: 0 }, time + dt, hull - after, time);
      frames++; clock = time + dt; previousS = s; lastHull = after;
      if (after > sim.state.hull + .02 || fatal) return fail(fatal ? 'traffic-collision-ignored' : 'traffic-damage-ignored',
        fatal ? 'the recorded frame has a fatal collision with server-simulated traffic, but the ride claimed completion'
          : `traffic requires hull ${sim.state.hull.toFixed(2)}, frame reports ${after.toFixed(2)}`, clock, s);
      if (after < sim.state.hull - .02) return fail('traffic-proof-invalid', 'post-contact hull does not match the shared traffic response', clock, s);
      const key = Math.round(clock * 100), candidates = posts.get(key) ?? [];
      candidates.push([sim.state.s, sim.state.d, sim.state.psi, sim.state.v, sim.state.hull]); posts.set(key, candidates);
    }
    for (const sample of batch.body.samples) {
      const candidates = posts.get(Math.round(sample[0]! * 100)) ?? [];
      if (!candidates.some((p) => Math.abs(p[0]! - sample[1]!) <= .051 && Math.abs(p[1]! - sample[2]!) <= .0051
        && Math.abs(p[2]! - sample[3]!) <= .00051 && Math.abs(p[3]! - sample[4]!) <= .0051 && Math.abs(p[4]! - sample[7]!) <= .051)) {
        return fail('traffic-proof-mismatch', 'a recorded sample does not match any simulated traffic frame at that time', sample[0]!, sample[1]!);
      }
    }
  }
  if (!frames || clock + .11 < ride.driveSeconds) return fail('traffic-proof-missing', 'traffic frames do not cover the completed ride', clock, previousS);
  return [];
}
