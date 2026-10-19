import type { GeoHeaders } from '../../../ports/prize/geo-locator.port.js';

export class StartRideCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    /** the trip the game built its road from (null = not said – not compared) */
    public readonly trip: string | null = null,
    /** true = this start is for the weekly skill board. A refusal is a 409; the ride is not silently downgraded. */
    public readonly ranked = false,
    /** edge geo headers. Read only when `ranked` is true. */
    public readonly headers: GeoHeaders = {},
  ) {}
}
