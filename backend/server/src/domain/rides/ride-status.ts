export enum RideStatus {
  Created = 'created',
  AwaitingPayment = 'awaiting_payment',
  Running = 'running',
  Completed = 'completed',
  Abandoned = 'abandoned',
  Failed = 'failed',
  Expired = 'expired',
  Cancelled = 'cancelled',
}

/** The statuses in which a wallet still has a ride "in hand" (at most one at a time). */
export const OPEN_RIDE_STATUSES: readonly RideStatus[] = [RideStatus.Created, RideStatus.Running, RideStatus.AwaitingPayment];

export type RideOutcome = 'shift' | 'failed';
