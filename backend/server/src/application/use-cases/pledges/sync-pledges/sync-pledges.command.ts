/** One pass of the pledge job (SyncPledgesHandler). */
export class SyncPledgesCommand {}

export interface PledgeSyncDto {
  /** the pledge job sends settle / refund only with the payout key; without it, it only follows the chain */
  sending: boolean;
  checked: number;
  activated: number;
  settled: number;
  refunded: number;
  abandoned: number;
  errors: { pledgeId: string; note: string }[];
}
