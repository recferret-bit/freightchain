import type { PaidTierId } from '../../../domain/rides/ride-tier.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/** The road seed of a paid tier on a UTC day (ride.DailySeed) – what every pay-per-ride order of that tier that day is driven on. */
export abstract class DailySeedRepositoryPort {
  /**
   * The seed of `tier` on `day`: `candidate` when this call stores the day's first one, otherwise the one already stored. Two first orders racing: the second waits on
   * the key until the first commits and then reads its seed, so a day never has two roads.
   */
  abstract claim(tier: PaidTierId, day: string, candidate: number, at: Date, tx?: TransactionHandle): Promise<number>;
}
