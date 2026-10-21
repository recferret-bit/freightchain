import type { EffectId } from '../../../../domain/live/live-rules.js';

/** A spectator wants to pay for a donation (LIVE_FREE_DONATIONS=off): the order + the unsigned transfer to the driver. */
export class CreateDonationOrderCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly effect: EffectId,
    public readonly note: string | null,
    /** omitted = the 0.01 SOL preset */
    public readonly lamports: number | null = null,
  ) {}
}
