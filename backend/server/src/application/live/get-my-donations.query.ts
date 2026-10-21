/** The signed-in player's confirmed tips: what they sent, and what their rides received. */
export class GetMyDonationsQuery {
  constructor(public readonly wallet: string) {}
}
