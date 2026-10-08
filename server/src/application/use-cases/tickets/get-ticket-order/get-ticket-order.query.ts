export class GetTicketOrderQuery {
  constructor(
    public readonly wallet: string,
    public readonly orderId: string,
  ) {}
}
