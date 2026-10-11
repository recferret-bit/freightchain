/** Opens the ride page. The account is the blink client’s wallet; this route does not buy. */
export class OpenRideActionCommand {
  constructor(readonly rideId: string, readonly account: string) {}
}
