import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../src/domain/rides/ride-status.js';
import type { RideReport } from '../../../src/domain/rides/ride-report.js';
import { ConflictError } from '../../../src/domain/shared/errors.js';
import { FREE_LEVELS } from '../../../src/domain/rides/ride-trip.js';
import { ROUTE_IDS, START_HOURS, worldFor } from '../../../src/domain/rides/ride-rules.js';

const T0 = new Date('2026-10-07T12:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const rules = { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 };
const report = (over: Partial<RideReport> = {}): RideReport => ({ s: 0, t: null, hull: null, paused: false, night: false, ...over });
const freeRide = () => Ride.createFree({ id: 'ride-1', wallet: 'w', seed: 7, minSeconds: 10, now: T0 }); // 10 s AND 140 m
const running = () => { const r = freeRide(); r.start(T0); return r; };
const order = () => Ride.createPaidOrder({ id: 'ride-2', wallet: 'w', tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, priceUsd: 5, lamports: 50_000_000, solUsd: 100, now: T0, quoteTtlMs: 600_000 });

describe('Ride – the free ride\'s helpers', () => {
  it('are off unless chosen; only the free tier has them', () => {
    expect(freeRide()).toMatchObject({ tutorial: false, assist: false });
    expect(Ride.createFree({ id: 'r', wallet: 'w', seed: 7, minSeconds: 10, now: T0, tutorial: true, assist: true })).toMatchObject({ tutorial: true, assist: true });
    expect(order()).toMatchObject({ tutorial: false, assist: false });
  });

  it('a ready free ride\'s helpers can be re-chosen (true = it changed and must be saved); a running one cannot, nor can a paid one', () => {
    const r = freeRide();                                                      // EASY, 10 s
    expect(r.chooseFree(1, 10, false, false)).toBe(false);
    expect(r.chooseFree(1, 10, true, false)).toBe(true);
    expect(r).toMatchObject({ tutorial: true, assist: false });
    expect(r.chooseFree(1, 10, true, false)).toBe(false);
    expect(r.chooseFree(1, 10, false, true)).toBe(true);
    expect(r.snapshot()).toMatchObject({ tutorial: false, assist: true });
    r.start(T0);
    expect(() => r.chooseFree(1, 10, true, true)).toThrow(ConflictError);
    expect(() => Ride.createFromTicket({ id: 't', wallet: 'w', tier: '4h', seed: 3, minSeconds: 240, timeScale: 1, poolId: 9, roundId: 4, now: T0 }).chooseFree(1, 10, false, true)).toThrow(new ConflictError('a level is for free rides only', 'level_free_only'));
  });
});

describe('Ride – the free LEVELS (EASY / MEDIUM / HARD)', () => {
  const free = (level: 1 | 2 | 3, minSeconds: number, assist = false) => Ride.createFree({ id: 'r', wallet: 'w', seed: 7, minSeconds, now: T0, level, assist });

  it('each level stamps its trip and its own finish line (k × 28 m/s × minSeconds); no level = EASY; a paid ride has none', () => {
    expect(free(1, 60)).toMatchObject({ trip: 'free-1c', level: 1, minSeconds: 60, completeDist: 0.3 * 28 * 60 });
    expect(free(2, 180)).toMatchObject({ trip: 'free-2c', level: 2, minSeconds: 180, completeDist: 0.4 * 28 * 180 });
    expect(free(3, 600)).toMatchObject({ trip: 'free-3b', level: 3, minSeconds: 600, completeDist: 0.4 * 28 * 600 });
    expect(order().level).toBeNull();
    expect(Ride.restore({ ...freeRide().snapshot(), trip: 'free' }).level).toBeNull();   // a free ride from before the levels
  });

  it('HARD refuses TUTORIAL and ASSIST (409) – at creation and when re-chosen; EASY and CROSSROADS take them', () => {
    expect(() => free(3, 600, true)).toThrow(new ConflictError('the HARD free run has no assist', 'assist_not_allowed'));
    expect(() => Ride.createFree({ id: 'r', wallet: 'w', seed: 7, minSeconds: 600, now: T0, level: 3, tutorial: true })).toThrow(new ConflictError('the HARD free run has no tutorial', 'tutorial_not_allowed'));
    expect(free(1, 60, true).assist).toBe(true);
    expect(free(2, 180, true).assist).toBe(true);
    expect(Ride.createFree({ id: 'r', wallet: 'w', seed: 7, minSeconds: 60, now: T0, level: 1, tutorial: true }).tutorial).toBe(true);
    expect(() => free(3, 600).chooseFree(3, 600, false, true)).toThrow(ConflictError);
    expect(() => free(3, 600).chooseFree(3, 600, true, false)).toThrow(new ConflictError('the HARD free run has no tutorial', 'tutorial_not_allowed'));
  });

  it('a ready free ride is re-chosen as a whole: level (trip, length, line) + helpers; nothing changed = false; HARD + assist changes nothing', () => {
    const r = free(2, 180, true);
    expect(r.chooseFree(2, 180, false, true)).toBe(false);
    expect(() => r.chooseFree(3, 600, false, true)).toThrow(ConflictError);
    expect(() => r.chooseFree(3, 600, true, false)).toThrow(ConflictError);
    expect(r).toMatchObject({ trip: 'free-2c', minSeconds: 180, assist: true });
    expect(r.chooseFree(3, 600, false, false)).toBe(true);
    expect(r).toMatchObject({ trip: 'free-3b', route: 'brenner', level: 3, minSeconds: 600, completeDist: 0.4 * 28 * 600, tutorial: false, assist: false });
    expect(() => order().chooseFree(1, 60, false, false)).toThrow(ConflictError);
    r.start(T0);
    expect(() => r.chooseFree(1, 60, false, false)).toThrow(ConflictError);   // a running ride keeps its road
  });
});

describe('Ride – the world the server assigns', () => {
  it('a free ride\'s country is its level\'s; the start hour still comes from the seed; a paid ride takes both from the seed; a report cannot change the route', () => {
    const r = freeRide();
    expect(r).toMatchObject({ route: FREE_LEVELS[1].route, startHour: worldFor(7).startHour });
    expect(r.route).not.toBe(worldFor(7).route);   // seed 7 is not the EASY country: the level wins
    expect(Ride.createFree({ id: 'r2', wallet: 'w', seed: 7, minSeconds: 180, now: T0, level: 2 }).route).toBe(FREE_LEVELS[2].route);
    expect(Ride.createFree({ id: 'r3', wallet: 'w', seed: 7, minSeconds: 600, now: T0, level: 3 }).route).toBe(FREE_LEVELS[3].route);
    expect(order()).toMatchObject({ route: worldFor(1).route, startHour: worldFor(1).startHour });
    r.start(T0);
    r.applyReport({ ...report({ s: 1, t: 1 }), route: 'siberia' } as RideReport, at(1), rules);
    expect(r.route).toBe(FREE_LEVELS[1].route);
  });
  it('re-choosing a ready free ride moves its country with the level, including one ordered before the countries were fixed', () => {
    const old = Ride.restore({ ...freeRide().snapshot(), route: 'siberia' });
    expect(old.chooseFree(1, 10, false, false)).toBe(true);
    expect(old.route).toBe(FREE_LEVELS[1].route);
    expect(old.chooseFree(1, 10, false, false)).toBe(false);
  });
  it('worldFor is a pure function of the seed that reaches every route and every hour', () => {
    const seen = new Set<string>(), hours = new Set<number>();
    for (let s = 0; s < 40; s++) { const w = worldFor(s); seen.add(w.route); hours.add(w.startHour); expect(worldFor(s)).toEqual(w); }
    expect(seen.size).toBe(ROUTE_IDS.length);
    expect([...hours].sort((a, b) => a - b)).toEqual([...START_HOURS]);
  });
});

describe('Ride – creation', () => {
  it('a free ride is ready at once; completion needs EASY’s 0.3 × 28 m/s × minSeconds metres (the free run ends at a shorter line than a paid shift)', () => {
    expect(freeRide()).toMatchObject({ status: RideStatus.Created, minSeconds: 10, completeDist: 84, isFree: true, version: 1, trip: 'free-1c', level: 1 });
  });

  it('a paid order awaits payment with its price and expiry locked in', () => {
    const o = order();
    expect(o).toMatchObject({ status: RideStatus.AwaitingPayment, lamports: 50_000_000, priceUsd: 5, tier: '1h', isFree: false });
    expect(o.quoteIsLive(at(599))).toBe(true);
    expect(o.quoteIsLive(at(600))).toBe(false);
  });

  it('a ticket ride is paid and ready at once, in its pool and the pool\'s round; never for the free tier', () => {
    const r = Ride.createFromTicket({ id: 'ride-3', wallet: 'w', tier: '4h', seed: 3, minSeconds: 240, timeScale: 60, poolId: 9, roundId: 4, now: T0 });
    expect(r).toMatchObject({ status: RideStatus.Created, tier: '4h', poolId: 9, roundId: 4, isFree: false, lamports: 0, minSeconds: 240, timeScale: 60 });
    expect(r.snapshot()).toMatchObject({ paidAt: T0, quoteExpiresAt: null, completeDist: 3360 });
    expect(freeRide().poolId).toBeNull();
    expect(() => Ride.createFromTicket({ id: 'x', wallet: 'w', tier: 'free', seed: 1, minSeconds: 10, timeScale: 1, poolId: 1, roundId: 1, now: T0 })).toThrow(ConflictError);
  });
});

describe('Ride – lifecycle guards', () => {
  it('starting stamps what the ride is driven with (none = null = all classic, for everything before cosmetics)', () => {
    const r = freeRide();
    expect(r.loadout).toBeNull();
    r.start(T0, { wheel: 'gold', truck_color: 'red', gearbox: 'stick', dice: 'white', needle: 'orange' });
    expect(r.loadout).toEqual({ wheel: 'gold', truck_color: 'red', gearbox: 'stick', dice: 'white', needle: 'orange' });
    const plain = freeRide(); plain.start(T0);
    expect(plain.loadout).toBeNull();
  });

  it('cannot start twice, nor start an unpaid order', () => {
    const r = running();
    expect(() => r.start(at(1))).toThrow(new ConflictError('ride is running'));
    expect(() => order().start(at(1))).toThrow(new ConflictError('ride is awaiting_payment'));
  });

  it('markPaid turns an awaiting OR expired order into a ready ride in the round – and nothing else', () => {
    const awaiting = order();
    awaiting.markPaid(3, at(5));
    expect(awaiting).toMatchObject({ status: RideStatus.Created, roundId: 3 });
    const lapsed = order(); lapsed.expire(at(700)); lapsed.markPaid(3, at(701));
    expect(lapsed.status).toBe(RideStatus.Created);
    expect(() => awaiting.markPaid(3, at(9))).toThrow(ConflictError);
  });

  it('only an unstarted FREE ride can be cancelled (a paid one never is)', () => {
    const free = freeRide(); free.cancelReplaced(at(1));
    expect(free).toMatchObject({ status: RideStatus.Cancelled, reason: 'replaced by a paid ride' });
    const paid = order(); paid.markPaid(1, at(1));
    expect(() => paid.cancelReplaced(at(2))).toThrow('a paid ride is never cancelled');
    expect(() => running().cancelReplaced(at(2))).toThrow(ConflictError);
  });

  it('detects a stale running ride and can fail it', () => {
    const r = running();
    expect(r.isStaleRunning(at(150), rules)).toBe(false);
    expect(r.isStaleRunning(at(151), rules)).toBe(true);
    r.failHeartbeatLost(at(151));
    expect(r).toMatchObject({ status: RideStatus.Failed, reason: 'heartbeat lost' });
    expect(freeRide().isStaleRunning(at(9999), rules)).toBe(false); // not running
  });

  it('ignores heartbeats that come too soon', () => {
    const r = running();
    expect(r.canAcceptHeartbeat(at(0.5), rules)).toBe(false);
    expect(r.canAcceptHeartbeat(at(1), rules)).toBe(true);
  });
});

describe('Ride – progress reports', () => {
  it('credits the game clock, capped by the wall clock (+5 % + 1 s)', () => {
    const r = running();
    expect(r.applyReport(report({ s: 60, t: 4 }), at(4), rules)).toBe(true);
    expect(r.driveSeconds).toBe(4);
    expect(r.applyReport(report({ s: 90, t: 500 }), at(6), rules)).toBe(true); // claims 496 s in 2 s of wall time
    expect(r.driveSeconds).toBeCloseTo(4 + (2 * 1.05 + 1), 6);
  });

  it('without a usable game clock it trusts the paused flag', () => {
    const r = running();
    r.applyReport(report({ s: 10, t: null, paused: false }), at(5), rules);
    expect(r.driveSeconds).toBe(5);
    r.applyReport(report({ s: 10, t: null, paused: true }), at(10), rules);
    expect(r.driveSeconds).toBe(5);
    r.applyReport(report({ s: 10, t: 1 /* behind lastT? lastT is 0 so usable */, paused: false }), at(11), rules);
    expect(r.driveSeconds).toBe(6);
  });

  it('fails a ride that moves faster than a truck can', () => {
    const r = running();
    expect(r.applyReport(report({ s: 5000 }), at(2), rules)).toBe(false);
    expect(r.status).toBe(RideStatus.Failed);
    expect(r.reason).toMatch(/^implausible progress \(5000 m in 2\.0 s\)$/);
  });

  it('fails a ride whose reports stopped for too long', () => {
    const r = running();
    expect(r.applyReport(report({ s: 1 }), at(151), rules)).toBe(false);
    expect(r).toMatchObject({ status: RideStatus.Failed, reason: 'heartbeat lost' });
  });

  it('clamps the hull to 0..100, keeps it when unreported, accumulates night time', () => {
    const r = running();
    r.applyReport(report({ s: 1, t: 2, hull: -5, night: true }), at(2), rules);
    r.applyReport(report({ s: 2, t: 4, hull: null, night: false }), at(4), rules);
    const s = r.snapshot();
    expect(s).toMatchObject({ hull: 0, nightSeconds: 2, driveSeconds: 4 });
    r.applyReport(report({ s: 3, t: 6, hull: 250 }), at(6), rules);
    expect(r.snapshot().hull).toBe(100);
  });

  it('a missing distance keeps the last one (the lenient final report)', () => {
    const r = running();
    r.applyReport(report({ s: 40, t: 2 }), at(2), rules);
    r.applyReport(report({ s: null, t: 4 }), at(4), rules);
    expect(r.distance).toBe(40);
  });
});

describe('Ride – finishing', () => {
  const drive = (r: Ride, seconds: number, metres: number) => { r.applyReport(report({ s: metres, t: seconds }), at(seconds), rules); };

  it('completed = distance ≥ completeDist', () => {
    const r = running(); drive(r, 10, 140); r.finish('shift', null, at(10));
    expect(r).toMatchObject({ status: RideStatus.Completed, reason: 'shift complete' });
  });

  it('the line is the whole condition: time without distance is abandoned, distance in less than the nominal time completes', () => {
    const idle = running(); drive(idle, 60, 5); idle.finish('shift', null, at(60));
    const fast = running(); drive(fast, 5, 140); fast.finish('shift', null, at(5));
    expect(idle.status).toBe(RideStatus.Abandoned);
    expect(fast.status).toBe(RideStatus.Completed);
  });

  it("'failed' ends the ride with the (truncated) reason", () => {
    const r = running(); r.finish('failed', 'x'.repeat(500), at(1));
    expect(r.status).toBe(RideStatus.Failed);
    expect(r.reason).toHaveLength(200);
    const bare = running(); bare.finish('failed', null, at(1));
    expect(bare.reason).toBe('failed');
  });

  it('a finished ride cannot be finished again', () => {
    const r = running(); r.finish('failed', null, at(1));
    expect(() => r.finish('shift', null, at(2))).toThrow(new ConflictError('ride is failed'));
  });
});

describe('Ride – challenge channel', () => {
  const drive = (r: Ride, t: number) => r.applyReport(report({ s: t * 14, t }), at(t), rules);
  const KIND = { action: 'test', label: 'DO THE TEST', key: 'T', codes: ['KeyT'] };

  it('the shipped kinds table is empty: nothing is scheduled or issued', () => {
    const r = Ride.createFree({ id: 'ride-1', wallet: 'w', seed: 7, minSeconds: 1800, now: T0 });
    r.start(T0);
    drive(r, 130);
    expect(r.issueChallenge(at(130), 240, { id: 'c1', rnd: 0 })).toBeNull();
    expect(r.challenges).toEqual([]);
    expect(r.snapshot().nextChallengeAt).toBeNull();
    expect(r.openChallenge(at(140))).toBeNull();
  });

  it('when a kind is supplied, schedules the first prompt, issues it once the drive clock reaches it, then draws the next 0.6–1.4 intervals ahead', () => {
    const r = Ride.createFree({ id: 'ride-1', wallet: 'w', seed: 7, minSeconds: 1800, now: T0 }); // interval = min(240, 1800 / 4) = 240 s
    r.start(T0);
    drive(r, 10);
    expect(r.issueChallenge(at(10), 240, { id: 'c1', rnd: 0 }, [KIND])).toBeNull(); // scheduled at 120 s (0.5 × 240)
    expect(r.snapshot().nextChallengeAt).toBe(120);
    drive(r, 110);
    expect(r.issueChallenge(at(110), 240, { id: 'c1', rnd: 0 }, [KIND])).toBeNull();
    drive(r, 130);
    const c = r.issueChallenge(at(130), 240, { id: 'c1', rnd: 0.3 }, [KIND]);
    expect(c).toEqual({ id: 'c1', action: 'test', issuedMs: 130_000, deadlineMs: 150_000, codes: ['KeyT'] });
    expect(r.challenges).toEqual([c]);
    expect(r.snapshot().nextChallengeAt).toBeCloseTo(130 + 240 * (0.6 + 0.8 * 0.3));
    expect(r.openChallenge(at(140))).toEqual(c);
    expect(r.openChallenge(at(151))).toBeNull();
  });

  it('no prompts while paused, with the interval at 0, before the start, once ended, or past the cap', () => {
    const r = running();
    r.applyReport(report({ s: 20, t: 2 }), at(2), rules);
    expect(r.issueChallenge(at(2), 0, { id: 'x', rnd: 0 }, [KIND])).toBeNull();
    r.issueChallenge(at(2), 240, { id: 'x', rnd: 0 }, [KIND]); // scheduled at 1.25 s (interval 2.5 for a 10 s shift)
    r.applyReport(report({ s: 40, t: 4, paused: true }), at(4), rules);
    expect(r.issueChallenge(at(4), 240, { id: 'x', rnd: 0 }, [KIND])).toBeNull();
    r.applyReport(report({ s: 60, t: 6 }), at(6), rules);
    expect(r.issueChallenge(at(6), 240, { id: 'x', rnd: 0 }, [KIND])).not.toBeNull();
    r.finish('failed', 'crash', at(7));
    expect(r.issueChallenge(at(8), 240, { id: 'y', rnd: 0 }, [KIND])).toBeNull();
    expect(r.openChallenge(at(8))).toBeNull();
    expect(freeRide().issueChallenge(at(1), 240, { id: 'z', rnd: 0 }, [KIND])).toBeNull();
    const capped = Ride.restore({ ...running().snapshot(), driveSeconds: 1e6, nextChallengeAt: 0, challenges: Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, action: 'test', issuedMs: i, deadlineMs: i + 1 })) });
    expect(capped.issueChallenge(at(1), 240, { id: 'over', rnd: 0 }, [KIND])).toBeNull();
  });
});

describe('Ride – crash counters (statistics only)', () => {
  it('a report raises the running counts; a lower, missing or garbled one never lowers them; whole numbers, capped by the driven time (3 + one per 3 s, never above 200)', () => {
    const r = running();
    r.applyReport(report({ s: 10, crashesVehicle: 2, crashesBuilding: 0 }), at(5), rules);
    expect(r.snapshot()).toMatchObject({ crashesVehicle: 2, crashesBuilding: 0 });
    r.applyReport(report({ s: 20, crashesVehicle: 1 }), at(10), rules);
    r.applyReport(report({ s: 30, crashesVehicle: null, crashesBuilding: Number.NaN }), at(15), rules);
    expect(r.snapshot()).toMatchObject({ crashesVehicle: 2, crashesBuilding: 0 });
    r.applyReport(report({ s: 40, crashesVehicle: 3.9, crashesBuilding: 1 }), at(20), rules);
    expect(r.snapshot()).toMatchObject({ crashesVehicle: 3, crashesBuilding: 1 });
    r.applyReport(report({ s: 50, crashesVehicle: 10 ** 9, crashesBuilding: -4 }), at(25), rules);
    expect(r.snapshot()).toMatchObject({ crashesVehicle: 11, crashesBuilding: 1 });   // 25 s driven: the cap is 3 + 25 / 3
  });

  it('a report that fails the ride does not touch them', () => {
    const r = running();
    expect(r.applyReport(report({ s: 9000, crashesVehicle: 5 }), at(5), rules)).toBe(false);
    expect(r.snapshot()).toMatchObject({ status: RideStatus.Failed, crashesVehicle: 0 });
  });
});

