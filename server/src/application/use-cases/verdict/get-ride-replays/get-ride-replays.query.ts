import type { RideReplaysDto } from '../../../../domain/verdict/ride-replay.entity.js';

export type { RideReplaysDto };

export class GetRideReplaysQuery {
  constructor(
    readonly wallet: string | null,
    readonly rideId: string,
  ) {}
}
