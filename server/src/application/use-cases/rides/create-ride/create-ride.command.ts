import type { RideTierId } from '../../../../domain/rides/ride-tier.js';
import type { FreeLevel } from '../../../../domain/rides/ride-trip.js';

export class CreateRideCommand {
  constructor(
    public readonly wallet: string,
    public readonly tier: RideTierId,
    /** a free ride's helpers (false = off; a paid tier with either on is refused) */
    public readonly tutorial: boolean = false,
    public readonly assist: boolean = false,
    /** a free ride's LEVEL (null = not asked: level 1, EASY; a paid tier with a level is refused) */
    public readonly level: FreeLevel | null = null,
  ) {}
}
