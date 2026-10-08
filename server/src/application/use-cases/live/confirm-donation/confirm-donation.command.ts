/** "I paid this donation order with this transaction." */
export class ConfirmDonationCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly orderId: string,
    public readonly signature: string,
  ) {}
}
