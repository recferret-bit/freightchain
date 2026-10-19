export class ConfirmPledgeCommand {
  constructor(
    public readonly wallet: string,
    public readonly pledgeId: string,
    public readonly signature: string,
  ) {}
}
