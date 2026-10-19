import type { RideReport } from '../../../../domain/rides/ride-report.js';
import type { RideOutcome } from '../../../../domain/rides/ride-status.js';

export class EndRideCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly outcome: RideOutcome,
    public readonly report: RideReport,
    public readonly reason: string | null,
  ) {}
}
