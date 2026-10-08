export class GrantTicketsCommand {
  constructor(
    public readonly wallet: string,
    public readonly poolId: number,
    public readonly count: number,
    /** why – kept on the audit line */
    public readonly note: string | null,
  ) {}
}

export interface TicketsGrantedDto {
  wallet: string;
  poolId: number;
  /** what fitted under the pool's per-wallet cap */
  added: number;
  balance: number;
  cap: number;
}
