import { RideEvent } from '../../../../src/domain/live/ride-event.entity.js';
import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../src/domain/rides/ride-status.js';
import { RoadPlan } from '../../../../src/domain/road/road-plan.js';
import { RideBatch } from '../../../../src/domain/telemetry/ride-batch.entity.js';
import { REPLAY_PHYSICS_SUBSTEPS, REPLAY_SIM_HZ, ReplayEngine } from '../../../../src/domain/verdict/replay-engine.js';
import { RideReplay } from '../../../../src/domain/verdict/ride-replay.entity.js';
import { TrafficSimulator, tripTrafficFor } from '../../../../src/domain/verdict/traffic-sim.js';
import { VerdictStatus } from '../../../../src/domain/verdict/verdict.dto.js';
import { hashBatch, ownLaneHoles, recording } from '../../../support/recording.js';

function makeRide(seed = 424242, distance = 910, seconds = 70, trip: string | null = '1h'): Ride {
  const start = new Date('2026-04-01T12:00:00Z');
  const end = new Date(start.getTime() + seconds * 1000);
  const base = Ride.createFromTicket({
    id: 'ride-1',
    wallet: 'Wallet1111111111111111111111111111111111111',
    tier: '1h',
    seed,
    minSeconds: 60,
    timeScale: 1,
    poolId: 1,
    roundId: 1,
    now: start,
  });
  return Ride.restore({
    ...base.snapshot(),
    trip,
    status: RideStatus.Completed,
    startedAt: start,
    lastHbAt: end,
    endedAt: end,
    lastS: distance,
    lastT: seconds,
    driveSeconds: seconds,
    hull: 90,
  });
}

function toEntities(rideId: string, dtos: ReturnType<typeof recording>): RideBatch[] {
  const now = new Date('2026-04-01T12:01:00Z');
  return dtos.map((d) => RideBatch.accept(rideId, d, d.hash ?? hashBatch(d), now));
}

describe('ReplayEngine & TrafficSimulator (10 Hz backend verification)', () => {
  it('runs at 10 Hz (REPLAY_SIM_HZ = 10, 2 substeps) and matches 60 Hz fidelity at 1/6 the cost', () => {
    expect(REPLAY_SIM_HZ).toBe(10);
    expect(REPLAY_PHYSICS_SUBSTEPS).toBe(2);

    const ride = makeRide(123456, 910, 70);
    const batches = toEntities(ride.id, recording(ride.id, { seconds: 70, distance: 910, road: ride.seed, trip: ride.trip, replay: true }));
    const cmp = ReplayEngine.compareSimFrequencies(ride, batches);

    expect(cmp.speedupFactor).toBe(6);
    expect(cmp.hz60Steps).toBe(cmp.hz10Steps * 6);
    expect(cmp.speedRmse).toBeLessThan(3.0);
    expect(cmp.holesHit10Hz).toBe(cmp.holesHit60Hz);
    expect(cmp.trafficContacts10Hz).toBe(cmp.trafficContacts60Hz);
  });

  it('verifies an honest recording that dodges seeded traffic and takes planned hole damage', () => {
    const ride = makeRide(424242, 910, 70);
    const batches = toEntities(ride.id, recording(ride.id, { seconds: 70, distance: 910, road: ride.seed, trip: ride.trip, replay: true }));
    const out = ReplayEngine.verify(ride, batches, []);

    expect(out.redFlags).toEqual([]);
    expect(out.scores.simHz).toBe(10);
    expect(out.scores.physicsSubsteps).toBe(2);
    expect(out.scores.trafficSpawned).toBeGreaterThan(0);
    expect(out.scores.trafficCrashesIgnored).toBe(0);

    const replay = RideReplay.createPending({
      id: 'rep-1',
      rideId: ride.id,
      seq: 0,
      isPaid: true,
      seed: ride.seed,
      trip: ride.trip,
      now: new Date('2026-04-01T12:01:10Z'),
    });
    replay.markStarted(new Date('2026-04-01T12:01:10Z'));
    replay.complete({ ...out, now: new Date('2026-04-01T12:01:10Z') });
    expect(replay.status).toBe(VerdictStatus.Verified);
    expect(replay.toVerdictReasons()).toEqual([]);
    expect(replay.toDto().simHz).toBe(10);
  });

  it('catches a client that deleted traffic cars on the frontend and drove straight through them (traffic-collision-ignored)', () => {
    const ride = makeRide(424242, 910, 70);
    const batches = toEntities(
      ride.id,
      recording(ride.id, { seconds: 70, distance: 910, road: ride.seed, trip: ride.trip, replay: true, ignoreTraffic: true }),
    );
    const out = ReplayEngine.verify(ride, batches, []);

    expect(out.scores.trafficCrashesIgnored).toBeGreaterThan(0);
    expect(out.redFlags.some((f) => f.code === 'traffic-collision-ignored' && f.severity === 'reject')).toBe(true);
  });

  it('catches a client that deleted planned road holes and took no hull damage (obstacle-ignored)', () => {
    const seed = 77777;
    const [, h2] = ownLaneHoles(seed, 2, 0, '1h') as [number, number];
    const distance = Math.ceil(h2 + 60);
    const seconds = Math.ceil(distance / 20);
    const ride = makeRide(seed, distance, seconds, '1h');
    const batches = toEntities(ride.id, recording(ride.id, { seconds, distance, replay: true }));
    const out = ReplayEngine.verify(ride, batches, []);

    expect(out.redFlags.some((f) => f.code === 'obstacle-ignored' && f.severity === 'reject')).toBe(true);
  });

  it('correlates backend spectator donation events: flags unapplied effects, rejected ignored obstacles, and clock mismatches', () => {
    const ride = makeRide(424242, 910, 70);
    const batches = toEntities(ride.id, recording(ride.id, { seconds: 70, distance: 910, road: ride.seed, trip: ride.trip, replay: true }));

    const sample50 = batches[0]!.body.samples[50]!;
    const donatedSinkhole = RideEvent.restore({
      id: 101,
      rideId: ride.id,
      wallet: 'Spec111111111111111111111111111111111111111',
      kind: 'donation',
      text: 'enjoy the pit',
      effect: 'sinkhole',
      lamports: 1_000_000,
      slotKey: 'fx',
      slot: 1,
      createdAt: new Date('2026-04-01T12:00:01Z'),
      applied: { at: new Date('2026-04-01T12:00:01Z'), t: 1, s: sample50[1]!, lat: sample50[2]! },
      signature: null,
    });

    const unappliedEffect = RideEvent.restore({
      id: 102,
      rideId: ride.id,
      wallet: 'Spec111111111111111111111111111111111111111',
      kind: 'donation',
      text: 'never acked',
      effect: 'potholes',
      lamports: 1_000_000,
      slotKey: 'fx',
      slot: 2,
      createdAt: new Date('2026-04-01T12:00:10Z'),
      applied: null,
      signature: null,
    });

    const nightSwitch = RideEvent.restore({
      id: 103,
      rideId: ride.id,
      wallet: 'Spec111111111111111111111111111111111111111',
      kind: 'donation',
      text: 'lights out',
      effect: 'night',
      lamports: 1_000_000,
      slotKey: 'fx',
      slot: 3,
      createdAt: new Date('2026-04-01T12:00:15Z'),
      applied: { at: new Date('2026-04-01T12:00:16Z'), t: 16, s: 200, lat: null },
      signature: null,
    });

    const out = ReplayEngine.verify(ride, batches, [donatedSinkhole, unappliedEffect, nightSwitch]);
    const codes = out.redFlags.map((f) => f.code);
    expect(codes).toContain('donated-obstacle-ignored');
    expect(codes).toContain('event-unapplied');
    expect(codes).toContain('event-clock-mismatch');
    expect(out.eventsExpected).toBe(3);
  });

  it('deterministically reproduces traffic from mulberry32((seed ^ 0x9e3779b9) >>> 0)', () => {
    const plan = RoadPlan.forSeed(424242, '1h');
    const simA = new TrafficSimulator(424242, '1h', plan);
    const simB = new TrafficSimulator(424242, '1h', plan);

    for (let i = 1; i <= 100; i++) {
      const p: [number, number, number, number, number] = [(i - 1) * 0.1, (i - 1) * 2.0, 2.4, 0, 20];
      const q: [number, number, number, number, number] = [i * 0.1, i * 2.0, 2.4, 0, 20];
      simA.stepSamplePair(p, q);
      simB.stepSamplePair(p, q);
    }
    expect(simA.summary().spawned).toBeGreaterThan(0);
    expect(simA.summary().spawned).toBe(simB.summary().spawned);
    expect(simA.cars.map((c) => [c.id, c.s, c.lat, c.v])).toEqual(simB.cars.map((c) => [c.id, c.s, c.lat, c.v]));
    expect(tripTrafficFor('1h').traffic).toBe(1);
  });

  it('aggregates multi-axle passes per hole so ignoring 1 planned hole flags obstacle-no-impact instead of rejecting', () => {
    const seed = 77777;
    const [h1, h2] = ownLaneHoles(seed, 2, 0, '1h') as [number, number];
    const distance = Math.min(Math.floor(h2 - 15), Math.ceil(h1 + 25));
    const seconds = Math.ceil(distance / 14);
    const ride = makeRide(seed, distance, seconds, '1h');
    const batches = toEntities(ride.id, recording(ride.id, { seconds, distance, road: seed, trip: '1h', replay: true }));
    for (const b of batches) for (const r of b.body.samples) r[7] = 100;
    const out = ReplayEngine.verify(ride, batches, []);

    expect(out.scores.plannedHolesIgnored).toBe(1);
    expect(out.redFlags.some((f) => f.code === 'obstacle-no-impact' && f.severity === 'flag')).toBe(true);
    expect(out.redFlags.some((f) => f.code === 'obstacle-ignored')).toBe(false);
  });

  it('consistently verifies honest replays and rejects traffic-ignoring replays across 50 seeds', () => {
    for (let s = 1; s <= 50; s++) {
      const seed = (s * 2654435761) >>> 0;
      const ride = makeRide(seed, 910, 70, '1h');
      const honestBatches = toEntities(ride.id, recording(ride.id, { seconds: 70, distance: 910, road: seed, trip: '1h', replay: true }));
      const honestOut = ReplayEngine.verify(ride, honestBatches, []);
      expect(honestOut.redFlags.filter((f) => f.severity === 'reject')).toEqual([]);

      const cheatedBatches = toEntities(
        ride.id,
        recording(ride.id, { seconds: 70, distance: 910, road: seed, trip: '1h', replay: true, ignoreTraffic: true }),
      );
      const cheatedOut = ReplayEngine.verify(ride, cheatedBatches, []);
      expect(cheatedOut.scores.trafficCrashesIgnored).toBeGreaterThan(0);
      expect(cheatedOut.redFlags.some((f) => f.code === 'traffic-collision-ignored' && f.severity === 'reject')).toBe(true);
    }
  });
});
