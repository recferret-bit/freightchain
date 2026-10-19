export class GetRideQuery {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
  ) {}
}
