import type { EffectId } from '../live/live-rules.js';
import type { RideEvent } from '../live/ride-event.entity.js';
import type { Ride } from '../rides/ride.entity.js';
import { roadPlanFor, type PlannedHole } from '../road/road-plan.js';
import { AXLES, HOLE_REF_SPEED, HOLE_TYPES, OFFROAD_FAIL_SECONDS, WHEEL, holeDamage, type HoleTypeId } from '../road/road-rules.js';
import type { RideBatch } from '../telemetry/ride-batch.entity.js';
import { unsafeSamples } from '../telemetry/sample-safety.js';
import { PREFIX_ROWS } from '../telemetry/world-facts.js';
import {
  GAME_TIME_FACTOR, RECORDING_GRACE_MS,
  SAMPLE_BRAKE_COL, SAMPLE_CLOCK_COL, SAMPLE_D_COL, SAMPLE_GAS_COL, SAMPLE_GEAR_COL,
  SAMPLE_HULL_COL, SAMPLE_INPUT_COL, SAMPLE_MIN_COLS, SAMPLE_S_COL, SAMPLE_T_COL, SAMPLE_V_COL, isPhoneInput,
} from '../telemetry/telemetry-rules.js';
import { checkChallenges } from './challenge-checks.js';
import { checkHumanTiming } from './human-checks.js';
import { checkAgreement, checkChain, checkInputsPresent, checkSamples } from './recording-checks.js';
import { EMPTY_REPLAY_SCORES, type ReplayRedFlag, type ReplaySimScores } from './ride-replay.entity.js';
import { verifyTrafficProof } from './traffic-proof.js';
import { ReplayPhysics } from './replay-physics.js';
import { TrafficSimulator } from './traffic-sim.js';
import { EVENT_APPLY_GRACE_MS, REPLAY_PHYSICS_SUBSTEPS, REPLAY_SIM_HZ, stepTruckPhysics } from '../shared/index.js';
import {
  GASLESS_MIN_DV, GASLESS_REJECT_GAIN, GASLESS_REJECT_STEPS, OBSTACLE_IGNORED_REJECT,
  OFFROAD_FACTOR, OFFROAD_SLACK_SECONDS, PASS_CLEAR_METRES, PASS_DAMAGE_SHARE, PASS_MIN_DAMAGE,
} from './verdict-rules.js';

/* Required frame proofs replay traffic exactly. Historical 10 Hz recordings lack frame timing and state,
   so their reconstructed traffic discrepancies remain review evidence. */

export { EVENT_APPLY_GRACE_MS, REPLAY_PHYSICS_SUBSTEPS, REPLAY_SIM_HZ, stepTruckPhysics };

const MAX_SPEED = HOLE_REF_SPEED;

const EFFECT_TO_HOLE: Readonly<Partial<Record<EffectId, HoleTypeId>>> = {
  potholes: 'cluster',
  trench: 'trench',
  sinkhole: 'sinkhole',
};

export interface ReplayVerificationOutput {
  readonly batchesCount: number;
  readonly samplesCount: number;
  readonly recordedSeconds: number;
  readonly simulatedSeconds: number;
  readonly recordedDistance: number;
  readonly simulatedDistance: number;
  readonly recordedHull: number;
  readonly simulatedHull: number;
  readonly simulatedCrashesVehicle: number;
  readonly simulatedCrashesBuilding: number;
  readonly eventsExpected: number;
  readonly eventsCorrelated: number;
  readonly redFlags: ReplayRedFlag[];
  readonly scores: ReplaySimScores;
}

const round = (v: number, d = 100): number => Math.round(v * d) / d;

interface DonatedObstacle extends PlannedHole {
  readonly eventId: number;
  readonly effect: EffectId;
  readonly appliedT: number;
}

interface ObstacleOutcome<T extends PlannedHole> {
  readonly obstacle: T;
  atSecond: number;
  expected: number;
  actual: number;
  hit: boolean;
}

export class ReplayEngine {
  static verify(
    ride: Ride,
    batches: readonly RideBatch[],
    events: readonly RideEvent[] = [],
  ): ReplayVerificationOutput {
    const ordered = [...batches].sort((a, b) => a.seq - b.seq);
    const stoppedAt = ride.endedAt ?? ride.lastHbAt ?? ride.startedAt;
    const maxGameSeconds = (stoppedAt ? ride.recordingAllowance(stoppedAt).maxGameSeconds : 0) + RECORDING_GRACE_MS / 1000 * GAME_TIME_FACTOR;
    let prefix: readonly (readonly number[])[] = [];
    for (const batch of ordered) {
      // Stored batch clocks are untrusted too; retain the upload grace but bound road work by the server's ride timestamps.
      const unsafe = unsafeSamples(batch.seq, Math.min(batch.t1, maxGameSeconds), batch.body.samples, prefix);
      if (unsafe) return {
        batchesCount: ordered.length, samplesCount: ordered.reduce((n, b) => n + b.body.samples.length, 0),
        recordedSeconds: 0, simulatedSeconds: 0, recordedDistance: 0, simulatedDistance: 0, recordedHull: 0, simulatedHull: 0,
        simulatedCrashesVehicle: 0, simulatedCrashesBuilding: 0, eventsExpected: 0, eventsCorrelated: 0,
        redFlags: [{ code: 'bad-sample', category: 'recording', severity: 'reject', detail: unsafe, atSecond: null, atMetre: null, evidence: null }],
        scores: { ...EMPTY_REPLAY_SCORES },
      };
      if (batch.body.samples.length) prefix = batch.body.samples.slice(-PREFIX_ROWS);
    }
    const facts = ordered.map((b) => ({
      seq: b.seq, prevHash: b.prevHash, hash: b.hash, hashOk: b.hashOk, t0: b.t0, t1: b.t1, summary: b.summary,
    }));
    const redFlags: ReplayRedFlag[] = [];
    const addFlag = (f: ReplayRedFlag) => {
      if (!redFlags.some((x) => x.code === f.code && x.atSecond === f.atSecond)) redFlags.push(f);
    };

    const rideFacts = { rideId: ride.id, driveSeconds: ride.driveSeconds, distance: ride.distance, ranked: ride.ranked, cleanMetres: ride.cleanMetres };
    const plan = roadPlanFor(ride.seed, ride.trip);
    for (const r of checkChain(rideFacts, facts)) {
      addFlag({ code: r.code, category: 'recording', severity: r.severity, detail: r.detail, atSecond: null, atMetre: null, evidence: null });
    }
    if (ordered.length > 0) {
      const road = { forkSwitch: (s0: number, s1: number) => plan.layout.forkSwitch(s0, s1) };
      for (const r of checkSamples(facts, road).reasons) {
        addFlag({ code: r.code, category: 'recording', severity: r.severity, detail: r.detail, atSecond: null, atMetre: null, evidence: null });
      }
      for (const r of checkAgreement(rideFacts, facts).reasons) {
        addFlag({ code: r.code, category: 'recording', severity: r.severity, detail: r.detail, atSecond: null, atMetre: null, evidence: null });
      }
      for (const r of checkInputsPresent(rideFacts, facts)) {
        addFlag({ code: r.code, category: 'recording', severity: r.severity, detail: r.detail, atSecond: null, atMetre: null, evidence: null });
      }
      const inputs = ordered.flatMap((b) => b.body.inputs).filter((e) => !isPhoneInput(e));
      for (const r of checkHumanTiming(inputs).reasons) {
        addFlag({ code: r.code, category: 'human', severity: r.severity, detail: r.detail, atSecond: null, atMetre: null, evidence: null });
      }
      const endMs = ride.endedAt && ride.startedAt ? ride.endedAt.getTime() - ride.startedAt.getTime() : Number.POSITIVE_INFINITY;
      for (const r of checkChallenges(ride.challenges, inputs, endMs).reasons) {
        addFlag({ code: r.code, category: 'challenge', severity: r.severity, detail: r.detail, atSecond: null, atMetre: null, evidence: null });
      }
    }

    const rows = ordered.flatMap((b) => b.body.samples).filter((r) => Array.isArray(r) && r.length >= SAMPLE_MIN_COLS);
    const donatedObstacles: DonatedObstacle[] = [];
    let liveEventsExpected = 0;
    let liveEventsCorrelated = 0;
    let liveEventsUnapplied = 0;
    const endedMs = ride.endedAt?.getTime() ?? Number.POSITIVE_INFINITY;

    for (const ev of events) {
      if (!ev.needsGame || !ev.effect) continue;
      const postedBeforeEnd = endedMs - ev.snapshot().createdAt.getTime() >= EVENT_APPLY_GRACE_MS;
      if (!postedBeforeEnd && !ev.applied) continue;
      liveEventsExpected++;
      if (!ev.applied) {
        liveEventsUnapplied++;
        addFlag({
          code: 'event-unapplied', category: 'event', severity: 'flag',
          detail: `live effect "${ev.effect}" (event #${ev.id ?? 0}) was never applied by the client`,
          atSecond: null, atMetre: null, evidence: { eventId: ev.id, effect: ev.effect },
        });
        continue;
      }
      const effect = ev.effect;
      // Snow and clear move the cab. They are not holes and they do not move the clock.
      if (effect === 'snow' || effect === 'clear') continue;
      const holeType = EFFECT_TO_HOLE[effect];
      if (holeType) {
        liveEventsCorrelated++;
        if (ev.applied.lat !== null) {
          const evId = ev.id ?? donatedObstacles.length + 1;
          donatedObstacles.push({
            id: `donated-${evId}`,
            ci: -evId,
            s: ev.applied.s,
            lat: ev.applied.lat,
            type: holeType,
            eventId: ev.id ?? 0,
            effect,
            appliedT: ev.applied.t,
          });
        }
      } else if (effect === 'night' || effect === 'day') {
        const clockRow = rows.find((r) => r.length > SAMPLE_CLOCK_COL && r[SAMPLE_T_COL]! >= ev.applied!.t + 1.5 && r[SAMPLE_T_COL]! <= ev.applied!.t + 6);
        if (!clockRow) {
          liveEventsCorrelated++;
        } else {
          const hr = ((clockRow[SAMPLE_CLOCK_COL]! % 24) + 24) % 24;
          const ok = ev.effect === 'night' ? hr >= 19 || hr <= 6 : hr >= 6 && hr <= 19;
          if (ok) liveEventsCorrelated++;
          else {
            addFlag({
              code: 'event-clock-mismatch', category: 'event', severity: 'flag',
              detail: `live effect "${ev.effect}" at ${round(ev.applied.t, 10)} s did not switch the replay clock (hour ${round(hr, 10)})`,
              atSecond: round(ev.applied.t, 10), atMetre: round(ev.applied.s, 10), evidence: { eventId: ev.id, effect: ev.effect, clockHour: hr },
            });
          }
        }
      }
    }

    const trafficSim = new TrafficSimulator(ride.seed, ride.trip, plan, ride.route ?? undefined, donatedObstacles, ride.assist);
    const exactTraffic = ride.trafficVersion === 1;
    if (exactTraffic) for (const flag of verifyTrafficProof(ride, ordered, trafficSim)) addFlag(flag);
    const physics = new ReplayPhysics();
    const seenPlannedPits = new Set<string>(), seenDonatedPits = new Set<string>(), reachedPlannedHoles = new Set<string>();
    const plannedOutcomes = new Map<string, ObstacleOutcome<PlannedHole>>();
    const donatedOutcomes = new Map<string, ObstacleOutcome<DonatedObstacle>>();
    let offroadRun = 0, maxOffroadSeconds = 0, gaslessSteps = 0, gaslessGain = 0, physicsSpeedViolations = 0, maxSpeedGainRatio = 0;
    let simDistance = rows[0]?.[SAMPLE_S_COL] ?? 0, simHull = rows[0]?.[SAMPLE_HULL_COL] ?? 100;

    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1]!, q = rows[i]!, dt = q[SAMPLE_T_COL]! - p[SAMPLE_T_COL]!;
      if (!(dt > 0 && dt <= 2)) { physics.step(p, q, false); if (!exactTraffic) trafficSim.stepSamplePair(p, q); continue; }
      const s0 = p[SAMPLE_S_COL]!, s1 = q[SAMPLE_S_COL]!, d0 = p[SAMPLE_D_COL]!, d1 = q[SAMPLE_D_COL]!;
      const v0 = p[SAMPLE_V_COL]!, v1 = q[SAMPLE_V_COL]!, gas = Math.max(p[SAMPLE_GAS_COL]!, q[SAMPLE_GAS_COL]!);
      const brake = (p[SAMPLE_BRAKE_COL]! + q[SAMPLE_BRAKE_COL]!) / 2, gear = q[SAMPLE_GEAR_COL]!;

      const offroad = s1 >= plan.layout.knownFrom && plan.layout.onRoad(s1, d1) === false;
      if (s1 >= plan.layout.knownFrom) {
        offroadRun = offroad ? offroadRun + dt : Math.max(0, offroadRun - 2 * dt);
        if (offroadRun > maxOffroadSeconds) maxOffroadSeconds = offroadRun;
      }

      const { vMaxPossible } = stepTruckPhysics(v0, gas, brake, gear, offroad, dt, REPLAY_PHYSICS_SUBSTEPS);
      const vSim = physics.step(p, q, offroad);
      simDistance += ((v0 + vSim) / 2) * dt;
      const dv = v1 - v0;
      const gasKeyHeld = q.length > SAMPLE_INPUT_COL && ((q[SAMPLE_INPUT_COL]! & 1) !== 0);
      if (dv > GASLESS_MIN_DV && gas < 0.05 && !gasKeyHeld && s1 >= plan.layout.knownFrom) { gaslessSteps++; gaslessGain += dv; }
      const maxGain = Math.max(0.25, vMaxPossible - v0);
      if (dv > 0.6 && dv > maxGain) {
        const ratio = dv / maxGain;
        if (ratio > maxSpeedGainRatio) maxSpeedGainRatio = ratio;
        if (ratio > 1.8) physicsSpeedViolations++;
      }

      const hBefore = Math.max(p[SAMPLE_HULL_COL]!, rows[i - 2]?.[SAMPLE_HULL_COL] ?? p[SAMPLE_HULL_COL]!);
      const hAfter = Math.min(q[SAMPLE_HULL_COL]!, rows[i + 1]?.[SAMPLE_HULL_COL] ?? q[SAMPLE_HULL_COL]!, rows[i + 2]?.[SAMPLE_HULL_COL] ?? q[SAMPLE_HULL_COL]!);
      if (!exactTraffic) trafficSim.stepSamplePair(p, q, Math.max(0, hBefore - hAfter));

      if (s1 > s0 && s1 >= plan.layout.knownFrom) {
        for (const h of plan.holesNear(s0 - 15, s1 + 4)) {
          if (h.s <= s1 + AXLES[0]!) reachedPlannedHoles.add(h.id);
          const pass = ReplayEngine.checkHolePass(rows, i, h, seenPlannedPits);
          if (!pass) continue;
          simHull = Math.max(0, simHull - pass.expected);
          const cur = plannedOutcomes.get(h.id);
          if (!cur) plannedOutcomes.set(h.id, { obstacle: h, atSecond: q[SAMPLE_T_COL]!, expected: pass.expected, actual: pass.actual, hit: !pass.ignored });
          else { cur.expected += pass.expected; cur.actual = Math.max(cur.actual, pass.actual); if (!pass.ignored) cur.hit = true; }
        }
      }
      if (s1 > s0) {
        for (const dh of donatedObstacles) {
          if (q[SAMPLE_T_COL]! < dh.appliedT - 0.2) continue;
          const pass = ReplayEngine.checkHolePass(rows, i, dh, seenDonatedPits);
          if (!pass) continue;
          simHull = Math.max(0, simHull - pass.expected);
          const cur = donatedOutcomes.get(dh.id);
          if (!cur) donatedOutcomes.set(dh.id, { obstacle: dh, atSecond: q[SAMPLE_T_COL]!, expected: pass.expected, actual: pass.actual, hit: !pass.ignored });
          else { cur.expected += pass.expected; cur.actual = Math.max(cur.actual, pass.actual); if (!pass.ignored) cur.hit = true; }
        }
      }
      if (d0 !== d1 && v1 < 0) simDistance += 0;
    }

    let plannedHolesHit = 0, plannedHolesIgnored = 0;
    for (const out of plannedOutcomes.values()) {
      if (out.hit || out.actual >= out.expected * PASS_DAMAGE_SHARE) plannedHolesHit++;
      else plannedHolesIgnored++;
    }
    const plannedSeverity: 'reject' | 'flag' = plannedHolesIgnored >= OBSTACLE_IGNORED_REJECT ? 'reject' : 'flag';
    const plannedCode = plannedHolesIgnored >= OBSTACLE_IGNORED_REJECT ? 'obstacle-ignored' : 'obstacle-no-impact';
    for (const out of plannedOutcomes.values()) {
      if (out.hit || out.actual >= out.expected * PASS_DAMAGE_SHARE) continue;
      const h = out.obstacle;
      addFlag({
        code: plannedCode, category: 'obstacle', severity: plannedSeverity,
        detail: `drove through planned ${h.type} #${h.id} at ${round(h.s, 10)} m without taking hull damage (expected ${round(out.expected, 10)} %, actual ${round(out.actual, 10)} %)`,
        atSecond: round(out.atSecond, 10), atMetre: round(h.s, 10),
        evidence: { holeId: h.id, holeType: h.type, expectedDamage: round(out.expected, 10), actualDamage: round(out.actual, 10) },
      });
    }

    let donatedObstaclesHit = 0, donatedObstaclesIgnored = 0;
    for (const out of donatedOutcomes.values()) {
      if (out.hit || out.actual >= out.expected * PASS_DAMAGE_SHARE) donatedObstaclesHit++;
      else {
        donatedObstaclesIgnored++;
        const dh = out.obstacle;
        addFlag({
          code: 'donated-obstacle-ignored', category: 'event', severity: 'reject',
          detail: `drove through spectator-donated ${dh.effect} (event #${dh.eventId}) at ${round(dh.s, 10)} m without taking hull damage (expected ${round(out.expected, 10)} %, actual ${round(out.actual, 10)} %)`,
          atSecond: round(out.atSecond, 10), atMetre: round(dh.s, 10),
          evidence: { eventId: dh.eventId, effect: dh.effect, expectedDamage: round(out.expected, 10), actualDamage: round(out.actual, 10) },
        });
      }
    }

    const traffic = trafficSim.summary();
    for (const c of traffic.contacts) simHull = Math.max(0, simHull - c.expectedDamage);
    for (const c of traffic.contacts) {
      if (!c.ignored) continue;
      if (c.kind === 'crash') {
        addFlag({
          code: 'traffic-collision-ignored', category: 'traffic', severity: 'flag',
          detail: `reconstructed contact with ${c.vehicleName} at ${c.s} m (${c.t} s, closing ${c.closingSpeed} m/s); frame timing and trailer angle are not recorded, so this requires review`,
          atSecond: c.t, atMetre: c.s,
          evidence: { vehicleId: c.vehicleId, vehicleType: c.vehicleType, closingSpeed: c.closingSpeed, overlap: c.overlapFraction, actualHullDrop: c.actualHullDrop },
        });
      } else {
        addFlag({
          code: 'traffic-damage-ignored', category: 'traffic', severity: 'flag',
          detail: `reconstructed contact with ${c.vehicleName} at ${c.s} m (${c.t} s) caused ${c.actualHullDrop} % hull drop vs ${c.expectedDamage} % expected`,
          atSecond: c.t, atMetre: c.s,
          evidence: { vehicleId: c.vehicleId, vehicleType: c.vehicleType, expectedDamage: c.expectedDamage, actualHullDrop: c.actualHullDrop },
        });
      }
    }

    if (physics.violations >= 3) addFlag({
      code: 'physics-coasting-mismatch', category: 'physics', severity: 'flag',
      detail: `speed stayed above the carried braking/coasting estimate on ${physics.violations} samples; missing transient controls or impacts require review`,
      atSecond: null, atMetre: null, evidence: { samples: physics.violations, maxExcess: round(physics.maxExcess) },
    });

    const maxOffroadAllowed = OFFROAD_FAIL_SECONDS * OFFROAD_FACTOR + OFFROAD_SLACK_SECONDS;
    if (maxOffroadSeconds > maxOffroadAllowed) {
      addFlag({
        code: 'offroad-ignored', category: 'obstacle', severity: 'reject',
        detail: `${round(maxOffroadSeconds, 10)} s continuously off the tarmac (the game ends the ride at ${OFFROAD_FAIL_SECONDS} s)`,
        atSecond: null, atMetre: null, evidence: { maxOffroadSeconds: round(maxOffroadSeconds, 10) },
      });
    }
    if (gaslessSteps > 0) {
      const severity = gaslessGain >= GASLESS_REJECT_GAIN || gaslessSteps >= GASLESS_REJECT_STEPS ? 'reject' : 'flag';
      addFlag({
        code: 'accel-without-gas', category: 'physics', severity,
        detail: `gained ${round(gaslessGain, 10)} m/s across ${gaslessSteps} step(s) with the gas pedal up`,
        atSecond: null, atMetre: null, evidence: { gaslessSteps, gaslessGain: round(gaslessGain, 10) },
      });
    }
    if (physicsSpeedViolations >= 3) {
      addFlag({
        code: 'physics-speed-mismatch', category: 'physics', severity: 'reject',
        detail: `accelerated faster than engine torque allows on ${physicsSpeedViolations} steps (max ratio ${round(maxSpeedGainRatio, 10)}x)`,
        atSecond: null, atMetre: null, evidence: { physicsSpeedViolations, maxSpeedGainRatio: round(maxSpeedGainRatio, 10) },
      });
    }

    const firstRow = rows[0], lastRow = rows[rows.length - 1];
    const recordedSeconds = firstRow && lastRow ? Math.max(0, round(lastRow[SAMPLE_T_COL]! - firstRow[SAMPLE_T_COL]!, 100)) : 0;
    const recordedDistance = lastRow ? round(lastRow[SAMPLE_S_COL]!, 10) : 0;
    const recordedHull = lastRow ? round(lastRow[SAMPLE_HULL_COL]!, 10) : (ride.hull ?? 100);
    const totalEventsExpected = liveEventsExpected + ride.challenges.filter((c) => c.deadlineMs <= (endedMs - (ride.startedAt?.getTime() ?? 0))).length;
    const challengeAnswered = checkChallenges(
      ride.challenges,
      ordered.flatMap((b) => b.body.inputs).filter((e) => !isPhoneInput(e)),
      endedMs - (ride.startedAt?.getTime() ?? 0),
    ).scores.answered;

    const scores: ReplaySimScores = {
      simHz: REPLAY_SIM_HZ, physicsSubsteps: REPLAY_PHYSICS_SUBSTEPS,
      plannedHolesReached: reachedPlannedHoles.size, plannedHolesHit, plannedHolesIgnored,
      donatedObstaclesPlaced: donatedObstacles.length, donatedObstaclesHit, donatedObstaclesIgnored,
      liveEventsExpected, liveEventsCorrelated, liveEventsUnapplied,
      trafficSpawned: traffic.spawned, trafficContacts: traffic.contacts.length,
      trafficCrashesIgnored: traffic.ignoredCrashes,
      trafficBumpsIgnored: traffic.ignoredBumps,
      physicsSpeedViolations, maxSpeedGainRatio: round(maxSpeedGainRatio, 100),
      maxOffroadSeconds: round(maxOffroadSeconds, 100), gaslessSteps,
    };

    return {
      batchesCount: ordered.length, samplesCount: rows.length,
      recordedSeconds, simulatedSeconds: recordedSeconds,
      recordedDistance, simulatedDistance: round(simDistance, 10),
      recordedHull, simulatedHull: round(simHull, 10),
      simulatedCrashesVehicle: traffic.contacts.filter((c) => c.kind !== 'scrape').length,
      simulatedCrashesBuilding: 0,
      eventsExpected: totalEventsExpected, eventsCorrelated: liveEventsCorrelated + challengeAnswered,
      redFlags, scores,
    };
  }

  private static checkHolePass(
    rows: readonly number[][], i: number, h: PlannedHole, seenPits: Set<string>,
  ): { expected: number; actual: number; ignored: boolean } | null {
    const p = rows[i - 1]!, q = rows[i]!, spec = HOLE_TYPES[h.type];
    if (!spec) return null;
    const s0 = p[SAMPLE_S_COL]!, s1 = q[SAMPLE_S_COL]!;
    let expectedTotal = 0;
    for (let axle = 0; axle < AXLES.length; axle++) {
      const ax = AXLES[axle]!, a0 = s0 + ax, a1 = s1 + ax;
      for (let pit = 0; pit < spec.ells.length; pit++) {
        const e = spec.ells[pit]!, entry = h.s + e.ds - e.a, key = `${h.id}:${pit}:${axle}`;
        if (seenPits.has(key) || !(entry > a0 && entry <= a1)) continue;
        const alpha = (entry - a0) / (a1 - a0);
        const d = p[SAMPLE_D_COL]! + (q[SAMPLE_D_COL]! - p[SAMPLE_D_COL]!) * alpha;
        const v = p[SAMPLE_V_COL]! + (q[SAMPLE_V_COL]! - p[SAMPLE_V_COL]!) * alpha;
        const cl = h.lat + e.dl;
        if (Math.min(Math.abs(d - WHEEL - cl), Math.abs(d + WHEEL - cl)) >= e.b - PASS_CLEAR_METRES) continue;
        seenPits.add(key);
        const dmg = holeDamage(spec, v, axle);
        if (dmg >= PASS_MIN_DAMAGE) expectedTotal += dmg;
      }
    }
    if (expectedTotal < PASS_MIN_DAMAGE) return null;
    let before = rows[i - 1]![SAMPLE_HULL_COL]!, after = q[SAMPLE_HULL_COL]!;
    for (let k = Math.max(0, i - 3); k < i; k++) before = Math.max(before, rows[k]![SAMPLE_HULL_COL]!);
    for (let k = i; k <= Math.min(rows.length - 1, i + 3); k++) after = Math.min(after, rows[k]![SAMPLE_HULL_COL]!);
    const actual = Math.max(0, before - after);
    return { expected: expectedTotal, actual, ignored: actual < expectedTotal * PASS_DAMAGE_SHARE };
  }

}
