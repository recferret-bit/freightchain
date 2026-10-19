/** Opens the ride page, or (`watch`) its stream / replay. The account is the blink client’s wallet; this route does not buy. */
export class OpenRideActionCommand {
  constructor(readonly rideId: string, readonly account: string, readonly target: 'page' | 'watch' = 'page') {}
}
