/** Who is watching a ride right now – a soft count for the driver's HUD and the watch page (no storage: a restart forgets it, fine for a counter). */
export abstract class ViewerPresencePort {
  /** `viewer` polled the ride at `now`; returns how many distinct viewers polled it within the window. */
  abstract seen(rideId: string, viewer: string, now: Date): number;
  /** the count without registering anyone (the driver's own poll) */
  abstract count(rideId: string, now: Date): number;
}
