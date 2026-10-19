import { RideEvent } from '../../../../src/domain/live/ride-event.entity.js';
import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../src/domain/rides/ride-status.js';
import { RoadPlan } from '../../../../src/domain/road/road-plan.js';
import { RideBatch } from '../../../../src/domain/telemetry/ride-batch.entity.js';
import { ReplayEngine } from '../../../../src/domain/verdict/replay-engine.js';
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
  it.each([1e12, 1e7, -1e7, NaN])('rejects unsafe stored rows (%s) even with a cached good summary, before creating the road', (s) => {
    const ride = makeRide();
    const batches = toEntities(ride.id, recording(ride.id, { seconds: 70, distance: 910 }));
    const saved = batches[0]!.snapshot();
    const samples = saved.body.samples.map((r) => [...r]);
    samples[1]![1] = s;
    batches[0] = RideBatch.restore({ ...saved, body: { ...saved.body, samples } });
    expect(batches[0].summary.fault).toBeNull();
    const plan = vi.spyOn(RoadPlan, 'forSeed').mockImplementation(() => { throw new Error('unsafe road generation'); });
    try {
      const result = ReplayEngine.verify(ride, batches);
      expect(result.redFlags).toEqual([expect.objectContaining({ code: 'bad-sample', severity: 'reject' })]);
      expect(result.simulatedSeconds).toBe(0);
      expect(Object.values(result.scores).every(Number.isFinite)).toBe(true);
      expect(plan).not.toHaveBeenCalled();
    } finally { plan.mockRestore(); }
  });

  it('preflights the boundary across an empty stored batch', () => {
    const ride = makeRide(424242, 20_000, 1010);
    const [base] = toEntities(ride.id, recording(ride.id, { seconds: 10 }));
    const row = (t: number, s: number) => [t, s, 2.4, 0, 0, 900, 1, 100, 0, 0, 0, 0];
    const batches = [[row(1000, 10_000)], [], [row(1000.1, 20_000)]].map((samples, seq) => RideBatch.restore({
      ...base!.snapshot(), seq, t0: 1000, t1: 1001, body: { ...base!.body, seq, t0: 1000, t1: 1001, samples },
    }));
    const plan = vi.spyOn(RoadPlan, 'forSeed').mockImplementation(() => { throw new Error('unsafe road generation'); });
    try {
      expect(ReplayEngine.verify(ride, batches).redFlags).toEqual([expect.objectContaining({ code: 'bad-sample', detail: expect.stringContaining('road work') })]);
      expect(plan).not.toHaveBeenCalled();
    } finally { plan.mockRestore(); }
  });

  it('does not let historical batch and sample clocks buy a road beyond the server ride duration', () => {
    const ride = makeRide();
    const [batch] = toEntities(ride.id, recording(ride.id, { seconds: 10 }));
    const body = { ...batch!.body, t0: 1e7 - 1, t1: 1e7, samples: [[1e7, 1e7, 2.4, 0, 0, 900, 1, 100, 0, 0, 0, 0]] };
    const saved = RideBatch.restore({ ...batch!.snapshot(), t0: body.t0, t1: body.t1, body });
    const plan = vi.spyOn(RoadPlan, 'forSeed').mockImplementation(() => { throw new Error('unsafe road generation'); });
    try {
      expect(ReplayEngine.verify(ride, [saved]).redFlags[0]).toMatchObject({ code: 'bad-sample', severity: 'reject' });
      expect(plan).not.toHaveBeenCalled();
    } finally { plan.mockRestore(); }
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

  it('traffic reconstruction is independent of optional replay columns and display-only traffic tracks', () => {
    const ride = makeRide(424242, 910, 70);
    const batches = toEntities(
      ride.id,
      recording(ride.id, { seconds: 70, distance: 910, road: ride.seed, trip: ride.trip, replay: true, ignoreTraffic: true }),
    );
    for (const b of batches) for (const r of b.body.samples) {
      r[1] = r[0]! * 20; r[2] = 2.4 + Math.sin(r[0]! / 3) * 3.2;
      r[3] = .1 * Math.sin(r[0]! / 4); r[4] = 20; r[7] = 100;
    }
    const out = ReplayEngine.verify(ride, batches, []);

    const short = batches.map((b) => RideBatch.restore({ ...b.snapshot(), body: { ...b.body, samples: b.body.samples.map((r) => r.slice(0, 12)), traffic: [] } }));
    const legacy = ReplayEngine.verify(ride, short);
    expect(out.scores.trafficContacts).toBeGreaterThan(0);
    expect(out.redFlags.filter((f) => f.category === 'traffic').length).toBeGreaterThan(0);
    expect(legacy.scores.trafficSpawned).toBe(out.scores.trafficSpawned);
    expect(legacy.scores.trafficContacts).toBe(out.scores.trafficContacts);
    expect(legacy.redFlags.filter((f) => f.category === 'traffic')).toEqual(out.redFlags.filter((f) => f.category === 'traffic'));
    expect(out.redFlags.filter((f) => f.category === 'traffic').every((f) => f.severity === 'flag')).toBe(true);
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

});
