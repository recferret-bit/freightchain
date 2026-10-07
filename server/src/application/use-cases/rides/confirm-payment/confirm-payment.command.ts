import type { RideDto } from '../../../../domain/rides/ride.dto.js';

export class ConfirmPaymentCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly signature: string,
  ) {}
}

/** `pending` = the transaction is not visible at `confirmed` yet – ask again. */
export type ConfirmPaymentResultDto = { status: 'paid'; ride: RideDto } | { status: 'pending' };
