import type { TransactionHandle } from '../ports/shared/transaction.port.js';

/** `ride.Ride.finishRulesVersion` (integer, nullable). Lane 1 adds the column. A missing column is not an error. */
export abstract class FinishRulesPort {
  abstract stamp(rideId: string, finishRulesVersion: number, tx?: TransactionHandle): Promise<boolean>;
}
