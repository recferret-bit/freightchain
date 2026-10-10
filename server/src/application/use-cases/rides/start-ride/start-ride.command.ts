export class StartRideCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    /** the trip the game built its road from (null = not said – not compared) */
    public readonly trip: string | null = null,
  ) {}
}
