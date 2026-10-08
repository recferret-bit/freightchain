/** Who is watching a ride right now – a soft count for the driver's HUD and the watch page (no storage: a restart forgets it, fine for a counter). */
export abstract class ViewerPresencePort {
  /** `viewer` (the page's random id) from `source` (the client IP) polled the ride at `now`; returns how many distinct viewers polled it within the
      window. At most VIEWERS_PER_SOURCE ids count per source, so made-up ids cannot inflate the number. */
  abstract seen(rideId: string, source: string, viewer: string, now: Date): number;
  /** the count without registering anyone (the driver's own poll) */
  abstract count(rideId: string, now: Date): number;
}
