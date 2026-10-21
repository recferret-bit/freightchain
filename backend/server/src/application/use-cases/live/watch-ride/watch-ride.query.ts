/** A spectator's poll of a ride: recording batches from seq `from`, feed events after id `after` + those stamped after `since` (epoch ms, 0 = none);
    `viewer` = the watch page's random id for the viewer count ('' = not counted), `source` = the client IP it is counted under. */
export class WatchRideQuery {
  constructor(
    public readonly rideId: string,
    public readonly from: number,
    public readonly after: number,
    public readonly viewer: string,
    public readonly since = 0,
    public readonly source = '',
    /** the watch page is closing: this viewer stops counting now */
    public readonly leave = false,
    /** the signed-in wallet, when the cookie was sent. A pool replay before payout opens only for this driver. */
    public readonly caller: string | null = null,
  ) {}
}
