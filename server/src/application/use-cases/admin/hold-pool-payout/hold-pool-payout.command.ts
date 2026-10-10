/** A signed admin hold (or release) of one pool's automatic payout (`AdminIntent` pool_hold). */
export class HoldPoolPayoutCommand {
  constructor(
    public readonly admin: string,
    public readonly poolId: number,
    public readonly hold: boolean,
    public readonly note: string | null,
    public readonly requestId: string | null,
    public readonly signature: string,
  ) {}
}

export interface PoolHoldDto {
  poolId: number;
  held: boolean;
  by: string | null;
  at: number | null;
  note: string | null;
}
