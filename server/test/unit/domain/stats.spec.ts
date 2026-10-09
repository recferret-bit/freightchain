import { RideStatus } from '../../../src/domain/rides/ride-status.js';
import type { RideProps } from '../../../src/domain/rides/ride.entity.js';
import { EMPTY_STATS, addStats, countsForStats, donationDelta, rideDelta, statsDrift, toStatsDto } from '../../../src/domain/stats/stats.js';

const ride = (over: Partial<RideProps>): RideProps => ({ tier: 'free', status: RideStatus.Failed, startedAt: new Date(0), lastS: 820, driveSeconds: 63, crashesVehicle: 2, crashesBuilding: 1, ...over } as RideProps);

describe('statistics (domain)', () => {
  it('a started ride that ended counts with what was really driven – a failed one too', () => {
    expect(rideDelta(ride({}))).toEqual({ rides: 1, ridesFree: 1, ridesPaid: 0, ridesCompleted: 0, seconds: 63, metres: 820, crashesVehicle: 2, crashesBuilding: 1, donations: 0, donationLamports: 0 });
    expect(rideDelta(ride({ status: RideStatus.Completed }))?.ridesCompleted).toBe(1);
    expect(rideDelta(ride({ status: RideStatus.Abandoned }))).toMatchObject({ rides: 1, ridesCompleted: 0 });
  });

  it('free and paid rides are counted apart (rides = free + paid)', () => {
    expect(rideDelta(ride({ tier: '1h' }))).toMatchObject({ rides: 1, ridesFree: 0, ridesPaid: 1 });
    expect(rideDelta(ride({ tier: 'free' }))).toMatchObject({ rides: 1, ridesFree: 1, ridesPaid: 0 });
  });

  it('a ride that never started, or has not ended, adds nothing', () => {
    for (const over of [{ startedAt: null }, { status: RideStatus.Running }, { status: RideStatus.Created }, { status: RideStatus.Cancelled }, { status: RideStatus.Expired }]) {
      expect(countsForStats(ride(over)), JSON.stringify(over)).toBe(false);
      expect(rideDelta(ride(over))).toBeNull();
    }
  });

  it('a donation always counts; its lamports only when a transfer paid it', () => {
    expect(donationDelta(5_000_000, true)).toEqual({ ...EMPTY_STATS, donations: 1, donationLamports: 5_000_000 });
    expect(donationDelta(5_000_000, false)).toEqual({ ...EMPTY_STATS, donations: 1, donationLamports: 0 });
    expect(donationDelta(-3, true).donationLamports).toBe(0);
  });

  it('the wire shape rounds time and distance and sums the crashes', () => {
    const dto = toStatsDto(addStats(rideDelta(ride({ lastS: 820.6, driveSeconds: 62.5 })) ?? EMPTY_STATS, donationDelta(7, true)));
    expect(dto).toEqual({ rides: 1, ridesFree: 1, ridesPaid: 0, ridesCompleted: 0, seconds: 63, metres: 821, crashes: 3, crashesVehicle: 2, crashesBuilding: 1, donations: 1, donationLamports: 7 });
  });

  it('drift: only fields that differ; float noise is not drift', () => {
    const a = { ...EMPTY_STATS, rides: 3, metres: 1000.004 };
    expect(statsDrift(a, { ...EMPTY_STATS, rides: 3, metres: 1000 })).toEqual({});
    expect(statsDrift(a, { ...EMPTY_STATS, rides: 4, metres: 1000 })).toEqual({ rides: { stored: 3, truth: 4 } });
  });
});
