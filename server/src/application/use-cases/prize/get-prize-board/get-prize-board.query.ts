import type { PrizeTier } from '../../../../domain/prize/prize-rules.js';

/** `at` null = the clock's current prize week. */
export class GetPrizeBoardQuery {
  constructor(public readonly tier: PrizeTier, public readonly at: Date | null = null) {}
}
