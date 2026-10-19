import type { PaidTierId } from '../../../domain/rides/ride-tier.js';

/** One ticket. The order command is the agreements gate and the player lock. */
export class PrepareShiftActionCommand {
  constructor(readonly account: string, readonly tier: PaidTierId) {}
}
