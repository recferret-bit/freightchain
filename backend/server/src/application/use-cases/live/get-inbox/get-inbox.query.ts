/** The driver's game polls what spectators sent to its ride since event id `after`. */
export class GetInboxQuery {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly after: number,
  ) {}
}
