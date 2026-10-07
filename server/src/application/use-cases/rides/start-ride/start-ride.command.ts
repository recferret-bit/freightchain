export class StartRideCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
  ) {}
}
