import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../src/domain/rides/ride-status.js';
import { GAME_SLACK_METRES, GAME_SPEED_SLACK, MAX_SPEED, RIDE_SLACK_METRES, RIDE_SPEED_SLACK } from '../../../../src/domain/rides/ride-rules.js';

/* What a heartbeat may claim (Ride.applyReport) – the pentest findings H3 (beats 1 s apart, each with the per-beat slack: 1.9× the governor) and S4-10
   (a game clock that stands still while s moves: 0 s credited, so the recording's coverage defaulted to 1). Replaces the PoC
   pentest/pocs/server/verdict-forge.spec.ts "does not credit along-road progress faster than the governor". */

const T0 = new Date(Date.UTC(2036, 9, 8, 12, 0, 0));
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const RULES = { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 };
const report = (s: number, t: number | null, paused = false) => ({ s, t, hull: 100, paused, night: false, crashesVehicle: null, crashesBuilding: null });

function running(): Ride {
  const ride = Ride.createFromTicket({ id: 'ride-1', wallet: 'w', tier: '1h', seed: 7, minSeconds: 3600, timeScale: 1, poolId: 1, roundId: 1, now: T0 });
  ride.start(T0);
  return ride;
}

describe('Ride.applyReport: progress bounds', () => {
  it('an honest drive on the governor, beating every 10 s, keeps running for an hour', () => {
    const ride = running();
    for (let i = 1; i <= 360; i++) expect(ride.applyReport(report(i * 10 * MAX_SPEED, i * 10), at(i * 10), RULES)).toBe(true);
    expect(ride.status).toBe(RideStatus.Running);
    expect(ride.driveSeconds).toBeCloseTo(3600);
  });

  it('beats 1 s apart at 50 m/s – each inside the per-beat slack – fail once the ride outruns the governor over its whole wall time', () => {
    const ride = running();
    let i = 0;
    while (ride.status === RideStatus.Running && i < 30) { i++; ride.applyReport(report(i * 50, i * 2), at(i), RULES); }   // a game clock running 2× so that rule passes
    expect(ride.status).toBe(RideStatus.Failed);
    expect(ride.snapshot().reason).toMatch(/since the start/);
    expect(i).toBeLessThanOrEqual(3);
    expect(ride.distance).toBeLessThanOrEqual(MAX_SPEED * RIDE_SPEED_SLACK * i + RIDE_SLACK_METRES);
  });

  it('a game clock that stands still (or runs backwards) while s moves fails the ride', () => {
    const still = running();
    still.applyReport(report(280, 10), at(10), RULES);
    expect(still.applyReport(report(280 + GAME_SLACK_METRES + 1, 10), at(20), RULES)).toBe(false);
    expect(still.snapshot().reason).toMatch(/of driving/);

    const back = running();
    back.applyReport(report(280, 10), at(10), RULES);
    expect(back.applyReport(report(300, 5, true), at(20), RULES)).toBe(false);
  });

  it('s may run a little ahead of v × game time (the inside of a curve, a fork, a push) – not far', () => {
    const ride = running();
    expect(ride.applyReport(report(MAX_SPEED * GAME_SPEED_SLACK * 10 + GAME_SLACK_METRES - 1, 10), at(10), RULES)).toBe(true);
    expect(ride.applyReport(report(ride.distance + MAX_SPEED * GAME_SPEED_SLACK * 10 + GAME_SLACK_METRES + 1, 20), at(20), RULES)).toBe(false);
  });

  it('network jitter: a beat that arrived late, then /end at once, still fits the per-beat slack', () => {
    const ride = running();
    ride.applyReport(report(280, 10), at(11), RULES);   // sent at game 10 s, arrived 1 s late
    expect(ride.applyReport(report(308, 11), at(11.3), RULES)).toBe(true);
  });

  it('an old client without t is held to the wall clock only', () => {
    const ride = running();
    expect(ride.applyReport(report(70, null), at(5), RULES)).toBe(true);
    expect(ride.applyReport(report(140, null, true), at(10), RULES)).toBe(true);
    expect(ride.driveSeconds).toBe(5);
  });
});
