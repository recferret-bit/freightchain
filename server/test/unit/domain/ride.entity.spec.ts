import { Ride } from '../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../src/domain/rides/ride-status.js';
import type { RideReport } from '../../../src/domain/rides/ride-report.js';
import { ConflictError } from '../../../src/domain/shared/errors.js';

const T0 = new Date('2026-10-07T12:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const rules = { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 };
const report = (over: Partial<RideReport> = {}): RideReport => ({ s: 0, t: null, hull: null, paused: false, route: null, night: false, ...over });
const freeRide = () => Ride.createFree({ id: 'ride-1', wallet: 'w', seed: 7, minSeconds: 10, now: T0 }); // 10 s AND 140 m
const running = () => { const r = freeRide(); r.start(T0); return r; };
const order = () => Ride.createPaidOrder({ id: 'ride-2', wallet: 'w', tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, priceUsd: 5, lamports: 50_000_000, solUsd: 100, now: T0, quoteTtlMs: 600_000 });

describe('Ride – creation', () => {
  it('a free ride is ready at once; completion needs 0.5 × 28 m/s × minSeconds metres', () => {
    expect(freeRide()).toMatchObject({ status: RideStatus.Created, minSeconds: 10, completeDist: 140, isFree: true, version: 1 });
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
  it('starting stamps the cabin the ride is driven in (none = null, the classic one for everything before cabins)', () => {
    const r = freeRide();
    expect(r.cabin).toBeNull();
    r.start(T0, 'noir');
    expect(r.cabin).toBe('noir');
    const plain = freeRide(); plain.start(T0);
    expect(plain.cabin).toBeNull();
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

  it('clamps the hull to 0..100, keeps it when unreported, whitelists the route, accumulates night time', () => {
    const r = running();
    r.applyReport(report({ s: 1, t: 2, hull: -5, route: 'siberia', night: true }), at(2), rules);
    r.applyReport(report({ s: 2, t: 4, hull: null, route: '<script>', night: false }), at(4), rules);
    const s = r.snapshot();
    expect(s).toMatchObject({ hull: 0, route: 'siberia', nightSeconds: 2, driveSeconds: 4 });
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

  it('completed = driven ≥ min AND distance ≥ completeDist', () => {
    const r = running(); drive(r, 10, 140); r.finish('shift', null, at(10));
    expect(r).toMatchObject({ status: RideStatus.Completed, reason: 'shift complete' });
  });

  it('time without distance, or distance without time, is abandoned', () => {
    const idle = running(); drive(idle, 60, 5); idle.finish('shift', null, at(60));
    const fast = running(); drive(fast, 5, 140); fast.finish('shift', null, at(5));
    expect(idle.status).toBe(RideStatus.Abandoned);
    expect(fast.status).toBe(RideStatus.Abandoned);
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
