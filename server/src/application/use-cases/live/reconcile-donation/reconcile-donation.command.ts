import type { ConfirmDonationResultDto } from '../../../../domain/live/live.dto.js';

/** The spectator paid from a phone: find the transfer by its reference key. */
export class ReconcileDonationCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly orderId: string,
  ) {}
}

export type ReconcileDonationResultDto = ConfirmDonationResultDto | { status: 'not_found' };
