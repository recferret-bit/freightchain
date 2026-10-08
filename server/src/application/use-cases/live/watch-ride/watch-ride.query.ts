/** A spectator's poll of a ride: recording batches from seq `from`, feed events after id `after`; `viewer` = the watch page's random id for the viewer count ('' = not counted). */
export class WatchRideQuery {
  constructor(
    public readonly rideId: string,
    public readonly from: number,
    public readonly after: number,
    public readonly viewer: string,
  ) {}
}
