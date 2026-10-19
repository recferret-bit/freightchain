import type { PaidTierId } from '../../../domain/rides/ride-tier.js';

export class GetShiftActionQuery {
  constructor(readonly tier: PaidTierId | null) {}
}
