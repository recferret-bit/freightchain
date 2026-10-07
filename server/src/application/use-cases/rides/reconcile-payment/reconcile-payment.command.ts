import type { RideDto } from '../../../../domain/rides/ride.dto.js';

export class ReconcilePaymentCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
  ) {}
}

/** `paid` = found (now or earlier) · `not_found` = no matching transaction in the wallet's recent history · anything else = the ride's own status (not awaiting payment). */
export interface ReconcilePaymentResultDto {
  status: string;
  ride?: RideDto;
}
