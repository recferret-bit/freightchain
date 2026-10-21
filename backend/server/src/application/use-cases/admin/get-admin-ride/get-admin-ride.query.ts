export class GetAdminRideQuery {
  constructor(public readonly rideId: string, public readonly actor: string | null = null) {}
}
