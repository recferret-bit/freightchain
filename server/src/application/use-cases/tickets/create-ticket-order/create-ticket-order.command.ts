export class CreateTicketOrderCommand {
  constructor(
    public readonly wallet: string,
    public readonly poolId: number,
    public readonly qty: number,
  ) {}
}
