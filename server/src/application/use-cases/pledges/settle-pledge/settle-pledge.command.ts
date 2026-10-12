export class SettlePledgeCommand {
  constructor(
    public readonly pledgeId: string,
    public readonly signature?: string | null,
    public readonly slot?: bigint | null,
  ) {}
}
