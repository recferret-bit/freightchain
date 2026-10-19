import type { RideReport } from '../../../../domain/rides/ride-report.js';

export class HeartbeatRideCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly report: RideReport,
  ) {}
}
