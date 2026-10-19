/** The ride's driver mutes (or unmutes) a spectator on that ride. */
export class MuteWalletCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly target: string,
    public readonly muted: boolean,
  ) {}
}
