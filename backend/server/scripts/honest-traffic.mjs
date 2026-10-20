// A hash-chained recording whose traffic frames are this process's TrafficSimulator, the same kernel the server replays.
// The pose is chosen here; the server does not invent one. A car overlapping the truck's lane moves the truck to the other lane before the step.
import { createHash } from 'node:crypto';
import { RoadPlan } from '../dist/domain/road/road-plan.js';
import { TrafficSimulator } from '../dist/domain/verdict/traffic-sim.js';
import { encodeTrafficProof } from '../../../frontend/client/shared/traffic-proof.js';

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

const TRUCK_HALF = 1.3;

function blockedAt(sim, s, d) {
  return sim.cars.some((c) => {
    const gap = c.s - s;
    if (gap < -(20 + (c.def?.len ?? 6)) || gap > 55 + (c.def?.len ?? 6)) return false;
    const half = (c.def?.w ?? 2) / 2;
    return Math.abs((c.lat ?? 0) - d) < TRUCK_HALF + half + 0.5;
  });
}

function onTarmac(plan, s, d) {
  return plan.layout.onRoad(s, d) !== false;
}

/** Wheels sit 1 m either side of d. A sinkhole (half-width 2 m) is a hit until |d − lat| > 3.4, and the trailer axle is 11.5 m behind, so the offset is held until that axle is past. */
const HOLE_CLEAR = 3.8;
function clearOfHoles(plan, s, d) {
  let aim = d;
  const ahead = s + 8;
  for (const h of plan.holesBetween(Math.max(0, s - 16), s + 40)) {
    if (Math.abs(aim - h.lat) > HOLE_CLEAR) continue;
    const sides = h.lat >= aim ? [h.lat - HOLE_CLEAR, h.lat + HOLE_CLEAR] : [h.lat + HOLE_CLEAR, h.lat - HOLE_CLEAR];
    const pick = sides.find((x) => onTarmac(plan, h.s, x) && onTarmac(plan, ahead, x));
    if (pick !== undefined) aim = pick;
  }
  return aim;
}

/** A clear on-road offset. Leaving the lane is only useful when that offset is still tarmac. */
function targetLane(sim, plan, s) {
  const options = [2.4, 3.4, 4.4, 5.2, 1.4, 0.4, -0.4, 6.2];
  for (const d of options) if (onTarmac(plan, s, d) && !blockedAt(sim, s, d)) return d;
  return 2.4;
}

function closingSpeed(sim, s, d, cruise) {
  let v = cruise;
  for (const c of sim.cars) {
    const gap = c.s - s;
    if (gap < 4 || gap > 70) continue;
    const half = (c.def?.w ?? 2) / 2;
    if (Math.abs((c.lat ?? 0) - d) > TRUCK_HALF + half + 0.8) continue;
    const room = gap - 18;
    v = Math.min(v, room <= 0 ? 0 : Math.min(c.v ?? cruise, cruise * (room / 40)));
  }
  return Math.max(0, v);
}

/**
 * Batches covering `metres` at `speed` m/s. `seed` / `trip` / `route` are the ride's.
 * Returns `{ batches, metres, seconds, hull }`.
 */
export function honestBatches({ rideId, seed, trip, route, metres, speed = 20, laneBias = 0 }) {
  const sim = new TrafficSimulator(seed, trip ?? null, undefined, route);
  const plan = RoadPlan.forSeed(seed, trip ?? null);
  const dt = 0.05;
  const frames = [];
  const samples = [];
  let s = 0;
  let d = 2.4;
  let v = 0;
  let pre = 100;
  let time = 0;
  let fatal = null;
  const cap = Math.ceil((metres / 2) / dt) + 20;
  const open = [];
  for (let i = 0; i < cap && s < metres - 1e-6; i++) {
    const laneAim = targetLane(sim, plan, s + 10) + (s > 40 ? laneBias : 0);
    const holeAim = clearOfHoles(plan, s, laneAim);
    const aim = onTarmac(plan, s + 4, holeAim) ? holeAim : laneAim;
    const nudge = Math.min(0.4, Math.abs(aim - d));
    if (nudge > 0 && onTarmac(plan, s + 2, d + Math.sign(aim - d) * nudge)) d += Math.sign(aim - d) * nudge;
    const capV = closingSpeed(sim, s, d, speed);
    v += Math.sign(capV - v) * Math.min(0.12, Math.abs(capV - v));
    s = Math.min(metres, s + v * dt);
    const t0 = Math.round(time * 1e5) / 1e5;
    const t1 = Math.round((time + dt) * 1e5) / 1e5;
    const step = t1 - t0;
    const heading = sim.geometry.roadAt(s).t ?? 0;
    const fs = round(s, 4), fd = round(d, 3), fv = round(v, 3), fty = round(heading, 5);
    const frame = [step, t0, fs, fd, 0, fty, fv, fv, pre, 0, 0, pre];
    const hit = sim.stepPose(step, { s: fs, d: fd, psi: 0, tyaw: fty, v: fv, vel: fv, hull: pre, rev: false, crashV: 0 }, t1, 0, t0);
    frame[11] = sim.state.hull;
    const fork = sim.net.forkAt(fs);
    if (fork && sim.net.setChoice(fork, 0)) sim.clearStretch(fork.f0, fork.f1);
    frames.push(frame);
    if ((i % 2) === 1 || s >= metres - 1e-6) {
      const st = sim.state;
      const sample = [
        round(t1, 2), round(st.s, 2), round(st.d, 3), round(st.psi, 4), round(st.v, 3),
        Math.round(900 + st.v * 50), 5, round(st.hull, 2), 1, 0, 0, 0,
      ];
      samples.push(sample);
      open.push({ frame, sample });
    } else open.push({ frame, sample: null });
    if (hit && !fatal) fatal = { at: s, hit };
    pre = sim.state.hull;
    time = t1;
    if (s >= metres) break;
  }
  const seconds = round(time, 2);
  const inputs = [[80, 'KeyW', 1], [Math.max(90, Math.round(seconds * 1000) - 40), 'KeyW', 0]];
  const batchSeconds = 12;
  const batches = [];
  let prevHash = rideId;
  for (let seq = 0, from = 0; from < open.length; seq++) {
    const t0 = open[from].frame[1];
    let to = from;
    while (to < open.length && open[to].frame[1] < t0 + batchSeconds - 1e-9) to++;
    if (to === from) to = from + 1;
    const slice = open.slice(from, to);
    const t1 = round(slice.at(-1).frame[1] + slice.at(-1).frame[0], 2);
    const body = {
      seq,
      prevHash,
      t0: round(t0, 2),
      t1,
      samples: slice.map((row) => row.sample).filter(Boolean),
      inputs: inputs.filter((e) => e[0] >= t0 * 1000 && e[0] < t1 * 1000),
      trafficProof: encodeTrafficProof(slice.map((row) => row.frame)),
    };
    from = to;
    const text = JSON.stringify({ seq: body.seq, prevHash: body.prevHash, t0: body.t0, t1: body.t1, samples: body.samples, inputs: body.inputs, trafficProof: body.trafficProof });
    const hash = sha256(text);
    batches.push({ ...body, hash });
    prevHash = hash;
  }
  return { batches, metres: s, seconds, hull: sim.state.hull, fatal };
}

/** A head-on in one lane is not the only line. Try nearby offsets and a slower cruise before giving up. */
export function honestUntilClear(args) {
  const biases = [args.laneBias ?? 0, 0, 0.45, -0.45, 0.9, -0.9, 1.3];
  const speeds = [args.speed ?? 20, 16, 12];
  let last;
  for (const laneBias of biases) {
    for (const speed of speeds) {
      last = honestBatches({ ...args, laneBias, speed });
      if (!last.fatal && last.metres + 1 >= args.metres) return last;
    }
  }
  return last;
}

/** The batch hash the server recomputes (ride-batch.entity.ts). */
export function batchText(body) {
  return JSON.stringify({
    seq: body.seq, prevHash: body.prevHash, t0: body.t0, t1: body.t1, samples: body.samples, inputs: body.inputs,
    ...(body.trafficProof !== undefined ? { trafficProof: body.trafficProof } : {}),
  });
}

/** Replay a prebuilt chain after `mutate`, keeping the unhashed-batch link the verdict expects. */
export function rechain(rideId, batches, mutate = () => null, hashOf = (_b, text) => sha256(text)) {
  let prevHash = rideId;
  const out = [];
  for (const batch of batches) {
    const base = { ...batch, prevHash };
    const body = mutate(base) ?? base;
    const hash = hashOf(body, batchText(body));
    out.push({ ...body, hash });
    prevHash = hash ?? `unhashed-${body.seq}`;
  }
  return out;
}

/** Heartbeats follow `batches` (the honest line). A mutated upload must not be the line the heartbeat reports, or one jumped sample fails the ride. */
export async function paceRecording(call, rideId, batches, hull = 100) {
  const seconds = batches.at(-1)?.t1 ?? 0;
  const t0 = Date.now();
  const waitMs = Math.ceil(seconds * 1000 + 1200);
  while (Date.now() - t0 < waitMs) {
    const elapsed = (Date.now() - t0) / 1000;
    const beat = await call('POST', `rides/${rideId}/heartbeat`, { s: sAt(batches, elapsed), t: Math.min(seconds, elapsed), hull });
    if (beat.status !== 200) return beat;
    await sleep(Math.min(8000, Math.max(200, t0 + waitMs - Date.now())));
  }
  return { status: 200, json: {} };
}

export async function uploadBatches(call, rideId, batches) {
  for (const batch of batches) {
    const up = await call('POST', `rides/${rideId}/batches`, batch);
    if (up.status !== 200 || (up.json?.stored === false && up.json?.hashOk === false)) return up;
  }
  return { status: 200, json: {} };
}

/** Heartbeats stay inside the wall-clock speed bound, then the batches go up. */
export async function paceAndUpload(call, rideId, batches, hull = 100) {
  const paced = await paceRecording(call, rideId, batches, hull);
  if (paced.status !== 200) return paced;
  return uploadBatches(call, rideId, batches);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sAt(batches, t) {
  let s = 0;
  for (const b of batches) for (const row of b.samples) if (row[0] <= t + 1e-9) s = row[1];
  return s;
}

/**
 * Order, start, wait out the recording, upload it, end.
 * `call(method, path, body, headers)` → `{ status, json }`.
 */
export async function driveVerified(call, { cookie, tier, level, headers, speed = 20 }) {
  const body = { tier, ...(level ? { level, tutorial: false, assist: false } : {}) };
  const made = await call('POST', 'rides', body, headers);
  if (made.status !== 200) return { error: `order ${made.status} ${JSON.stringify(made.json).slice(0, 240)}` };
  const ride = made.json;
  const started = await call('POST', `rides/${ride.id}/start`, {}, headers);
  if (started.status !== 200) return { error: `start ${started.status} ${JSON.stringify(started.json).slice(0, 200)}`, ride };
  const built = honestUntilClear({
    rideId: ride.id, seed: ride.seed, trip: ride.trip, route: ride.route, metres: ride.completeDist + 5, speed,
  });
  if (built.fatal) return { error: `traffic ${built.fatal.hit} at ${Math.round(built.fatal.at)} m`, ride, built };
  if (built.metres + 1 < ride.completeDist) return { error: `short ${built.metres} < ${ride.completeDist}`, ride, built };
  const t0 = Date.now();
  const waitMs = Math.ceil(built.seconds * 1000 + 1200);
  while (Date.now() - t0 < waitMs) {
    const elapsed = (Date.now() - t0) / 1000;
    const beat = await call('POST', `rides/${ride.id}/heartbeat`, {
      s: sAt(built.batches, elapsed), t: Math.min(built.seconds, elapsed), hull: built.hull,
    }, headers);
    if (beat.status !== 200) return { error: `heartbeat ${beat.status} ${JSON.stringify(beat.json).slice(0, 200)}`, ride, built };
    await sleep(Math.min(8000, Math.max(0, t0 + waitMs - Date.now())));
  }
  for (const batch of built.batches) {
    const up = await call('POST', `rides/${ride.id}/batches`, batch, headers);
    if (up.status !== 200 || up.json?.stored === false && up.json?.hashOk === false) {
      return { error: `batch ${batch.seq} ${up.status} ${JSON.stringify(up.json).slice(0, 200)}`, ride, built };
    }
  }
  const end = await call('POST', `rides/${ride.id}/end`, { outcome: 'shift', s: built.metres, t: built.seconds, hull: built.hull }, headers);
  return { ride, built, end };
}
