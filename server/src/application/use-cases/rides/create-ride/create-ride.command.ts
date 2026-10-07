import type { RideTierId } from '../../../../domain/rides/ride-tier.js';

export class CreateRideCommand {
  constructor(
    public readonly wallet: string,
    public readonly tier: RideTierId,
  ) {}
}
