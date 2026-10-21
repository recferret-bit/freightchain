/** Shadow salt labels. The live road seed is not these values. */

export const TRAFFIC_SALT_LABEL = 'fc-salt:traffic';
export const HOLE_SALT_LABEL = 'fc-salt:hole';

/** HMAC material. The salt is a function of the ride id under the ride's session key. */
export function saltMessage(label, rideId) {
  return `${label}\n${rideId}`;
}
